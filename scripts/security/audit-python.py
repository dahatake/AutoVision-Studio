"""Collect current Windows C2 evidence; release decisions belong to the Node gate."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from collections.abc import Callable
from datetime import UTC, datetime
from http.client import HTTPException, HTTPMessage
from pathlib import Path
from typing import IO, Any, NoReturn, cast
from urllib.request import HTTPRedirectHandler, Request, build_opener

from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.specifiers import SpecifierSet
from packaging.utils import canonicalize_name
from packaging.version import Version

Json = dict[str, Any]
GHSA = re.compile(r"GHSA-[23456789cfghjmpqrvwx]{4}(?:-[23456789cfghjmpqrvwx]{4}){2}")


class AuditError(ValueError):
    """Incomplete evidence must never become a clean scan."""


class _RejectRedirects(HTTPRedirectHandler):
    """Stop before urllib opens a redirect destination."""

    def redirect_request(
        self,
        req: Request,
        fp: IO[bytes],
        code: int,
        msg: str,
        headers: HTTPMessage,
        newurl: str,
    ) -> NoReturn:
        fp.close()
        raise AuditError("Advisory response redirected or failed.")


def require(condition: object, message: str) -> None:
    if not condition:
        raise AuditError(message)


def _json_object(value: object, message: str) -> Json:
    if not isinstance(value, dict):
        raise AuditError(message)
    return cast(Json, value)


def _json_list(value: object, message: str) -> list[object]:
    if not isinstance(value, list):
        raise AuditError(message)
    return cast(list[object], value)


def _json_string(value: object, message: str) -> str:
    if not isinstance(value, str):
        raise AuditError(message)
    return value


def _json_strings(value: object, message: str) -> list[str]:
    return [_json_string(item, message) for item in _json_list(value, message)]


def _matches_advisory_package(value: object, name: str) -> bool:
    if not isinstance(value, dict):
        return False
    package = cast(Json, value).get("package")
    if not isinstance(package, dict):
        return False
    metadata = cast(Json, package)
    package_name = metadata.get("name")
    return (
        metadata.get("ecosystem") == "pip"
        and isinstance(package_name, str)
        and canonicalize_name(package_name) == name
    )


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pinned_requirement(line: str) -> tuple[Requirement, str]:
    requirement = Requirement(line)
    specs = list(requirement.specifier)
    require(not requirement.url and not requirement.extras, "Non-registry requirement.")
    require(len(specs) == 1 and specs[0].operator == "==", "Exact pin required.")
    version = specs[0].version
    require("*" not in version, "Wildcard pin is not an exact version.")
    require(str(Version(version)) == version, "Noncanonical Python version.")
    return requirement, version


def target_inventory(
    exported: str, lock: Json, project: Json, environment: dict[str, str]
) -> dict[str, Json]:
    require(lock.get("version") == 1, "Unsupported uv lock.")
    require(environment.get("implementation_name") == "cpython", "CPython required.")
    require(environment.get("sys_platform") == "win32", "Windows audit required.")
    require(environment.get("platform_machine") == "AMD64", "Windows x64 required.")
    require(environment.get("python_version") == "3.14", "Python 3.14 required.")
    require(
        environment["python_full_version"]
        in SpecifierSet(project["project"]["requires-python"]),
        "Unsupported Python patch version.",
    )
    packages = [
        _json_object(package, "Invalid locked package.")
        for package in _json_list(lock.get("package"), "Missing locked packages.")
    ]
    require(packages, "Missing locked packages.")
    inventory: dict[str, Json] = {}
    for line in exported.splitlines():
        if not line.strip():
            continue
        requirement, version = pinned_requirement(line)
        name = canonicalize_name(requirement.name)
        require(name != project["project"]["name"], "Local project leaked into audit.")
        matches = [
            p for p in packages if p.get("name") == name and p.get("version") == version
        ]
        require(len(matches) == 1, "Exported dependency is not uniquely locked.")
        package = matches[0]
        registry = package.get("source", {}).get("registry")
        approved = {index["url"] for index in project["tool"]["uv"]["index"]}
        require(registry in approved, "Unapproved dependency source.")
        if requirement.marker and not requirement.marker.evaluate(environment):
            continue
        require(name not in inventory, "Duplicate target dependency.")
        parsed = Version(version)
        if parsed.local:
            require(
                name in {"torch", "torchvision"}
                and parsed.local == "cpu"
                and registry == "https://download.pytorch.org/whl/cpu",
                "Unreviewed local-version advisory mapping.",
            )
        inventory[name] = {
            "name": name,
            "version": version,
            "auditVersion": parsed.public,
            "source": registry,
            "origin": "uv.lock",
        }
    require(inventory, "Empty target inventory.")
    # uv_build is not included in uv.lock. Its exact build-system pin is audited too.
    build = project.get("build-system", {})
    require(build.get("build-backend") == "uv_build", "Unreviewed build backend.")
    require(
        build.get("requires") == ["uv_build==0.12.9"], "Unreviewed build requirements."
    )
    require("uv-build" not in inventory, "Duplicate build backend.")
    inventory["uv-build"] = {
        "name": "uv-build",
        "version": "0.12.9",
        "auditVersion": "0.12.9",
        "source": "build-system.requires",
        "origin": "pyproject.toml",
    }
    return dict(sorted(inventory.items()))


def read_json_url(url: str) -> tuple[Json, str]:
    require(
        re.fullmatch(r"https://api\.github\.com/advisories/GHSA-[a-z0-9-]+", url)
        or url == "https://pypi.org/pypi/uv-build/0.12.9/json",
        "Unapproved advisory URL.",
    )
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "AutoVision-Dependency-Audit",
            "Cache-Control": "no-cache",
        },
    )
    try:
        with build_opener(_RejectRedirects()).open(request, timeout=20) as response:
            require(
                response.status == 200 and response.url == url,
                "Advisory response redirected or failed.",
            )
            raw = response.read(2 * 1024 * 1024 + 1)
    except HTTPException as error:
        raise AuditError("Advisory HTTP response failed.") from error
    require(len(raw) <= 2 * 1024 * 1024, "Advisory response too large.")
    data = _json_object(json.loads(raw), "Invalid advisory response.")
    return data, sha256(raw)


def collect_findings(
    report: Json, inventory: dict[str, Json], fetch: Callable[[str], tuple[Json, str]]
) -> tuple[list[Json], list[Json]]:
    report = _json_object(report, "Failed pip-audit report.")
    require("error" not in report, "Failed pip-audit report.")
    dependencies = _json_list(
        report.get("dependencies"), "Missing Python audit coverage."
    )
    require(dependencies, "Missing Python audit coverage.")
    require(report.get("fixes") == [], "Unexpected dependency fixes.")
    seen: set[str] = set()
    findings: list[Json] = []
    evidence: dict[str, Json] = {}
    for dependency_value in dependencies:
        dependency = _json_object(dependency_value, "Invalid audited dependency.")
        require("skip_reason" not in dependency, "pip-audit skipped a dependency.")
        name = _json_string(
            dependency.get("name"), "Unexpected or duplicate audited dependency."
        )
        require(
            name in inventory and name not in seen,
            "Unexpected or duplicate audited dependency.",
        )
        require(
            dependency.get("version") == inventory[name]["auditVersion"],
            "Audited version differs from inventory.",
        )
        seen.add(name)
        vulnerabilities = _json_list(
            dependency.get("vulns"), "Missing vulnerability results."
        )
        for vulnerability_value in vulnerabilities:
            vulnerability = _json_object(vulnerability_value, "Invalid vulnerability.")
            identifier = _json_string(
                vulnerability.get("id"), "Missing vulnerability ID."
            )
            require(identifier, "Missing vulnerability ID.")
            aliases = _json_strings(
                vulnerability.get("aliases"), "Missing vulnerability aliases."
            )
            fixes = _json_strings(
                vulnerability.get("fix_versions"), "Invalid fix versions."
            )
            ids = {identifier, *aliases}
            ghsas = sorted(i for i in ids if GHSA.fullmatch(i))
            require(ghsas, f"Reviewed severity unavailable for {identifier}.")
            severities: list[str] = []
            for ghsa in ghsas:
                url = f"https://api.github.com/advisories/{ghsa}"
                if ghsa not in evidence:
                    data, digest = fetch(url)
                    data = _json_object(data, "Invalid advisory response.")
                    require(data.get("ghsa_id") == ghsa, "Advisory ID mismatch.")
                    require(
                        data.get("type") == "reviewed"
                        and data.get("github_reviewed_at"),
                        "Unreviewed advisory.",
                    )
                    require(
                        "withdrawn_at" in data and data["withdrawn_at"] is None,
                        "Withdrawn or incomplete advisory; re-audit required.",
                    )
                    reviewed_severity = _json_string(
                        data.get("severity"), "Unknown reviewed severity."
                    )
                    require(
                        reviewed_severity in {"low", "medium", "high", "critical"},
                        "Unknown reviewed severity.",
                    )
                    evidence[ghsa] = {"url": url, "sha256": digest, "advisory": data}
                data = _json_object(
                    evidence[ghsa]["advisory"], "Invalid advisory response."
                )
                affected = _json_list(
                    data.get("vulnerabilities"), "Reviewed advisory package mismatch."
                )
                require(
                    any(_matches_advisory_package(value, name) for value in affected),
                    "Reviewed advisory package mismatch.",
                )
                severities.append(
                    _json_string(data["severity"], "Unknown reviewed severity.")
                )
            severity = max(severities, key=["low", "medium", "high", "critical"].index)
            selected = ghsas[severities.index(severity)]
            findings.append(
                {
                    "ecosystem": "pypi",
                    "package": name,
                    "version": inventory[name]["version"],
                    "auditVersion": inventory[name]["auditVersion"],
                    "id": selected,
                    "aliases": sorted(ids),
                    "severity": "moderate" if severity == "medium" else severity,
                    "fixVersions": fixes,
                    "url": evidence[selected]["url"],
                }
            )
    require(seen == set(inventory), "pip-audit omitted locked dependencies.")
    return findings, list(evidence.values())


def command(
    arguments: list[str], cwd: Path, timeout: int = 120
) -> subprocess.CompletedProcess[str]:
    # Do not inherit uv filtering/frozen settings or pip-audit output/service overrides.
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.upper().startswith(("UV_", "PIP_AUDIT_"))
    }
    return subprocess.run(
        arguments,
        cwd=cwd,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="strict",
        timeout=timeout,
        check=False,
        shell=False,
    )


def audit_python(repository_root: Path) -> Json:
    ml = repository_root / "ml"
    require(
        Path(sys.executable).resolve() == (ml / ".venv/Scripts/python.exe").resolve(),
        "Use ml/.venv/Scripts/python.exe.",
    )
    require(
        importlib.metadata.version("pip-audit") == "2.10.1",
        "pip-audit 2.10.1 required.",
    )
    require(
        importlib.metadata.version("packaging") == "26.3",
        "Locked packaging 26.3 required.",
    )
    uv = shutil.which("uv")
    require(uv, "Installed uv 0.12.9 required; no download/fallback.")
    assert uv is not None
    inputs = ["ml/pyproject.toml", "ml/uv.lock"]
    before = {path: (repository_root / path).read_bytes() for path in inputs}
    started = datetime.now(UTC).isoformat()
    try:
        version = command([uv, "--version"], ml)
        require(
            version.returncode == 0 and version.stdout.split()[:2] == ["uv", "0.12.9"],
            "uv 0.12.9 required.",
        )
        exported = command(
            [
                uv,
                "export",
                "--locked",
                "--offline",
                "--all-groups",
                "--all-extras",
                "--no-emit-project",
                "--no-hashes",
                "--no-header",
                "--no-annotate",
                "--no-python-downloads",
                "--project",
                str(ml),
                "--python",
                sys.executable,
            ],
            ml,
        )
        require(
            exported.returncode == 0, "uv locked export failed; no relock attempted."
        )
        environment = {
            key: _json_string(value, "Invalid marker environment.")
            for key, value in default_environment().items()
        }
        project = tomllib.loads(before[inputs[0]].decode("utf-8"))
        inventory = target_inventory(
            exported.stdout,
            tomllib.loads(before[inputs[1]].decode("utf-8")),
            project,
            environment,
        )
        installed: dict[str, str] = {}
        for distribution in importlib.metadata.distributions():
            name = canonicalize_name(distribution.metadata["Name"])
            require(name not in installed, "Duplicate installed distribution.")
            installed[name] = distribution.version
        expected = {
            name: item["version"]
            for name, item in inventory.items()
            if item["origin"] == "uv.lock"
        }
        expected[project["project"]["name"]] = project["project"]["version"]
        require(
            installed == expected,
            "Installed environment differs from all-group Windows lock; sync separately.",
        )
        build_url = "https://pypi.org/pypi/uv-build/0.12.9/json"
        build_data, build_hash = read_json_url(build_url)
        build_info = _json_object(
            build_data.get("info"), "Build backend metadata mismatch."
        )
        build_name = _json_string(
            build_info.get("name"), "Build backend metadata mismatch."
        )
        require(
            canonicalize_name(build_name) == "uv-build"
            and build_info.get("version") == "0.12.9",
            "Build backend metadata mismatch.",
        )
        requires_dist = build_info.get("requires_dist")
        require(
            "requires_dist" in build_info
            and (
                requires_dist is None
                or _json_list(
                    requires_dist,
                    "Build backend has unaccounted transitive dependencies.",
                )
                == []
            ),
            "Build backend has unaccounted transitive dependencies.",
        )
        with tempfile.TemporaryDirectory(prefix="autovision-audit-") as temporary:
            requirements = Path(temporary) / "requirements.txt"
            requirements.write_text(
                "".join(
                    f"{name}=={item['auditVersion']}\n"
                    for name, item in inventory.items()
                ),
                encoding="utf-8",
            )
            result = command(
                [
                    sys.executable,
                    "-I",
                    "-m",
                    "pip_audit",
                    "-r",
                    str(requirements),
                    "--no-deps",
                    "--disable-pip",
                    "--strict",
                    "--format",
                    "json",
                    "--vulnerability-service",
                    "pypi",
                    "--aliases",
                    "on",
                    "--desc",
                    "on",
                    "--progress-spinner",
                    "off",
                    "--timeout",
                    "20",
                    "--cache-dir",
                    str(Path(temporary) / "cache"),
                    "--output",
                    "stdout",
                ],
                ml,
                300,
            )
        require(result.returncode in {0, 1}, "pip-audit failed or timed out.")
        report = json.loads(result.stdout)
        findings, evidence = collect_findings(report, inventory, read_json_url)
        require(
            result.returncode == (1 if findings else 0),
            "pip-audit exit code and results disagree.",
        )
        return {
            "schemaVersion": 1,
            "scope": "C2",
            "status": "COLLECTED",
            "auditedAt": started,
            "completedAt": datetime.now(UTC).isoformat(),
            "environment": environment,
            "tool": {
                "name": "pip-audit",
                "version": "2.10.1",
                "exitCode": result.returncode,
                "uv": "0.12.9",
            },
            "dependencyCount": len(inventory),
            "inventory": list(inventory.values()),
            "findings": findings,
            "inputs": {path: sha256(data) for path, data in before.items()},
            "exportSha256": sha256(exported.stdout.encode("utf-8")),
            "rawReportSha256": sha256(result.stdout.encode("utf-8")),
            "rawReport": report,
            "severityEvidence": evidence,
            "buildEvidence": {
                "url": build_url,
                "sha256": build_hash,
                "metadata": build_info,
            },
        }
    finally:
        require(
            all(
                (repository_root / path).read_bytes() == data
                for path, data in before.items()
            ),
            "Python audit inputs changed during scan.",
        )


def main() -> None:
    try:
        require(len(sys.argv) == 1, "Run audit-python.py without filtering arguments.")
        print(
            json.dumps(
                audit_python(Path(__file__).resolve().parents[2]), ensure_ascii=True
            )
        )
    except (
        AuditError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        subprocess.SubprocessError,
    ) as error:
        print(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "scope": "C2",
                    "status": "BLOCKED",
                    "error": str(error),
                }
            ),
            file=sys.stderr,
        )
        sys.exit(2)


if __name__ == "__main__":
    main()
