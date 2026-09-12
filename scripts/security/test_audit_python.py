"""Offline fixtures for Windows lock coverage and reviewed advisory collection."""

from __future__ import annotations

import hashlib
import importlib.metadata
import importlib.util
import json
import socket
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from http.client import HTTPException, HTTPMessage, IncompleteRead
from io import BytesIO
from pathlib import Path
from typing import Any, NoReturn, cast
from unittest.mock import MagicMock, Mock
from urllib.request import HTTPRedirectHandler, OpenerDirector, Request

import pytest

SPEC = importlib.util.spec_from_file_location(
    "audit_python", Path(__file__).with_name("audit-python.py")
)
assert SPEC is not None and SPEC.loader is not None
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)

GHSA = "GHSA-h35f-9h28-mq5c"
ENVIRONMENT = {
    "implementation_name": "cpython",
    "sys_platform": "win32",
    "platform_machine": "AMD64",
    "python_version": "3.14",
    "python_full_version": "3.14.7",
}
SOURCE = "https://packagefeedproxy.microsoft.io/pypi/simple/"


def project() -> dict[str, Any]:
    return {
        "project": {
            "name": "autovision-ml",
            "requires-python": ">=3.14,!=3.14.1,<3.15",
        },
        "tool": {
            "uv": {
                "index": [
                    {"url": SOURCE},
                    {"url": "https://download.pytorch.org/whl/cpu"},
                ]
            }
        },
        "build-system": {"build-backend": "uv_build", "requires": ["uv_build==0.12.9"]},
    }


def lock() -> dict[str, Any]:
    return {
        "version": 1,
        "package": [
            {"name": "example", "version": "1.0.0", "source": {"registry": SOURCE}}
        ],
    }


def inventory() -> dict[str, Any]:
    return {"example": {"name": "example", "version": "1.0.0", "auditVersion": "1.0.0"}}


def report(vulnerable: bool = True) -> dict[str, Any]:
    vulns = (
        [
            {
                "id": "PYSEC-2026-1",
                "aliases": [GHSA, "CVE-2026-59890"],
                "fix_versions": ["2.0.0"],
            }
        ]
        if vulnerable
        else []
    )
    return {
        "dependencies": [{"name": "example", "version": "1.0.0", "vulns": vulns}],
        "fixes": [],
    }


def advisory(severity: str = "medium") -> dict[str, Any]:
    return {
        "ghsa_id": GHSA,
        "type": "reviewed",
        "github_reviewed_at": "2026-09-01T00:00:00Z",
        "withdrawn_at": None,
        "severity": severity,
        "vulnerabilities": [{"package": {"ecosystem": "pip", "name": "example"}}],
    }


def fetch_advisory(_url: str) -> tuple[dict[str, Any], str]:
    return advisory(), "a" * 64


def test_target_inventory_includes_build_backend() -> None:
    result = audit.target_inventory("example==1.0.0", lock(), project(), ENVIRONMENT)
    assert result["example"]["origin"] == "uv.lock"
    assert result["uv-build"]["version"] == "0.12.9"


def test_target_marker_is_evaluated_without_deleting_foreign_lock_entries() -> None:
    data = lock()
    data["package"].append(
        {"name": "foreign", "version": "1.0.0", "source": {"registry": SOURCE}}
    )
    before = json.dumps(data)
    result = audit.target_inventory(
        "example==1.0.0\nforeign==1.0.0; sys_platform == 'darwin'",
        data,
        project(),
        ENVIRONMENT,
    )
    assert "foreign" not in result
    assert json.dumps(data) == before


def test_cpu_local_version_retains_exact_identity_and_public_query_version() -> None:
    data = lock()
    data["package"] = [
        {
            "name": "torch",
            "version": "2.11.0+cpu",
            "source": {"registry": "https://download.pytorch.org/whl/cpu"},
        }
    ]
    result = audit.target_inventory("torch==2.11.0+cpu", data, project(), ENVIRONMENT)
    assert result["torch"]["version"] == "2.11.0+cpu"
    assert result["torch"]["auditVersion"] == "2.11.0"


@pytest.mark.parametrize(
    "line",
    [
        "",
        "example",
        "example>=1.0",
        "example==1.*",
        "example===1.0.0",
        "example @ https://example.test/file.whl",
        "-r private.txt",
        "example[extra]==1.0.0",
        "example==1.0.0\nexample==1.0.0",
        "missing==1.0.0",
        "example==1.0.0; sys_platform == 'darwin'",
    ],
)
def test_rejects_incomplete_or_unpinned_target(line: str) -> None:
    with pytest.raises(ValueError):
        audit.target_inventory(line, lock(), project(), ENVIRONMENT)


@pytest.mark.parametrize(
    "field,value",
    [
        ("sys_platform", "darwin"),
        ("platform_machine", "arm64"),
        ("implementation_name", "pypy"),
        ("python_version", "3.13"),
        ("python_full_version", "3.14.1"),
    ],
)
def test_rejects_unsupported_target(field: str, value: str) -> None:
    with pytest.raises(ValueError):
        audit.target_inventory(
            "example==1.0.0", lock(), project(), {**ENVIRONMENT, field: value}
        )


@pytest.mark.parametrize("packages", [None, {}, [], [None]])
def test_rejects_malformed_locked_packages(packages: object) -> None:
    data = lock()
    data["package"] = packages
    with pytest.raises(audit.AuditError):
        audit.target_inventory("example==1.0.0", data, project(), ENVIRONMENT)


def test_rejects_unreviewed_sources_and_build_backend() -> None:
    data = lock()
    data["package"][0]["source"] = {"git": "https://example.test"}
    with pytest.raises(ValueError):
        audit.target_inventory("example==1.0.0", data, project(), ENVIRONMENT)
    for field, value in [("requires", ["uv_build>=0.12"]), ("build-backend", "other")]:
        metadata = project()
        metadata["build-system"][field] = value
        with pytest.raises(ValueError):
            audit.target_inventory("example==1.0.0", lock(), metadata, ENVIRONMENT)


@pytest.mark.parametrize(
    "severity,expected",
    [
        ("low", "low"),
        ("medium", "moderate"),
        ("high", "high"),
        ("critical", "critical"),
    ],
)
def test_collects_reviewed_severity_without_waiving_any_finding(
    severity: str, expected: str
) -> None:
    def fetch(_url: str) -> tuple[dict[str, Any], str]:
        return advisory(severity), "a" * 64

    findings, evidence = audit.collect_findings(report(), inventory(), fetch)
    assert findings[0]["severity"] == expected
    assert findings[0]["id"] == GHSA
    assert evidence[0]["sha256"] == "a" * 64


def test_clean_complete_audit_needs_no_severity_request() -> None:
    def unexpected(_url: str) -> NoReturn:
        raise AssertionError("Unexpected network call")

    assert audit.collect_findings(report(False), inventory(), unexpected) == ([], [])


REPORT_MUTATIONS: list[Callable[[dict[str, Any]], object]] = [
    lambda r: r.update(error="network"),
    lambda r: r.update(fixes=[{}]),
    lambda r: r.update(dependencies=[]),
    lambda r: r["dependencies"][0].update(skip_reason="not found"),
    lambda r: r["dependencies"][0].update(version="2.0.0"),
    lambda r: r["dependencies"][0].update(name="missing"),
    lambda r: r["dependencies"].append(r["dependencies"][0]),
    lambda r: r["dependencies"][0].pop("vulns"),
    lambda r: r["dependencies"][0]["vulns"][0].pop("aliases"),
    lambda r: r["dependencies"][0]["vulns"][0].update(aliases=[]),
    lambda r: r["dependencies"][0]["vulns"][0].update(fix_versions="2.0.0"),
    lambda r: r.update(dependencies=None),
    lambda r: r.update(dependencies=[None]),
    lambda r: r["dependencies"][0].update(name=None),
    lambda r: r["dependencies"][0].update(vulns=None),
    lambda r: r["dependencies"][0].update(vulns=[None]),
    lambda r: r["dependencies"][0]["vulns"][0].update(id=None),
    lambda r: r["dependencies"][0]["vulns"][0].update(aliases=[None]),
    lambda r: r["dependencies"][0]["vulns"][0].update(fix_versions=[None]),
]


@pytest.mark.parametrize("mutation", REPORT_MUTATIONS)
def test_rejects_incomplete_python_audit(
    mutation: Callable[[dict[str, Any]], object],
) -> None:
    data = report()
    mutation(data)
    with pytest.raises(ValueError):
        audit.collect_findings(data, inventory(), fetch_advisory)


@pytest.mark.parametrize("data", [None, [], False])
def test_rejects_non_object_audit_report(data: object) -> None:
    with pytest.raises(audit.AuditError, match="Failed pip-audit report"):
        audit.collect_findings(data, inventory(), fetch_advisory)


ADVISORY_MUTATIONS: list[Callable[[dict[str, Any]], object]] = [
    lambda a: a.update(ghsa_id="different"),
    lambda a: a.update(type="unreviewed"),
    lambda a: a.update(github_reviewed_at=None),
    lambda a: a.update(withdrawn_at="2026-09-12T00:00:00Z"),
    lambda a: a.pop("withdrawn_at"),
    lambda a: a.update(severity="unknown"),
    lambda a: a.update(vulnerabilities=[]),
    lambda a: a["vulnerabilities"][0]["package"].update(ecosystem="npm"),
    lambda a: a["vulnerabilities"][0]["package"].update(name="other"),
    lambda a: a.update(severity=None),
    lambda a: a.update(severity=[]),
]


@pytest.mark.parametrize("mutation", ADVISORY_MUTATIONS)
def test_rejects_missing_or_mismatched_reviewed_severity(
    mutation: Callable[[dict[str, Any]], object],
) -> None:
    data = advisory()
    mutation(data)

    def fetch(_url: str) -> tuple[dict[str, Any], str]:
        return data, "a" * 64

    with pytest.raises(ValueError):
        audit.collect_findings(report(), inventory(), fetch)


def test_advisory_match_still_ignores_unrelated_malformed_entries() -> None:
    data = advisory()
    data["vulnerabilities"] = [
        None,
        {"package": None},
        {"package": {"ecosystem": "pip", "name": None}},
        *data["vulnerabilities"],
    ]

    def fetch(_url: str) -> tuple[dict[str, Any], str]:
        return data, "a" * 64

    findings, _evidence = audit.collect_findings(report(), inventory(), fetch)
    assert findings[0]["id"] == GHSA
    assert findings[0]["severity"] == "moderate"


def test_missing_dependency_not_hidden_by_clean_result() -> None:
    with pytest.raises(ValueError, match="omitted"):
        audit.collect_findings(
            report(False),
            {**inventory(), "missing": {"auditVersion": "2.0.0"}},
            fetch_advisory,
        )


def test_severity_fetch_error_is_not_a_clean_result() -> None:
    def failed(_url: str) -> NoReturn:
        raise OSError("offline")

    with pytest.raises(OSError):
        audit.collect_findings(report(), inventory(), failed)


@pytest.mark.parametrize(
    "url",
    [
        "file:///private",
        "http://api.github.com/advisories/test",
        "https://example.test",
        "https://api.github.com/advisories/../../user",
    ],
)
def test_fetch_rejects_unapproved_url_before_network(
    url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    make_opener = Mock(side_effect=AssertionError("Unexpected network call"))
    monkeypatch.setattr(audit, "build_opener", make_opener)
    with pytest.raises(ValueError):
        audit.read_json_url(url)
    make_opener.assert_not_called()


@pytest.mark.parametrize(
    "url",
    [
        f"https://api.github.com/advisories/{GHSA}",
        "https://pypi.org/pypi/uv-build/0.12.9/json",
    ],
)
def test_fetch_reads_json_object_and_hash(
    url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    raw = b'{"verified": true}\n'
    response = MagicMock(status=200, url=url)
    response.__enter__.return_value = response
    response.read.return_value = raw
    opener = Mock(spec=OpenerDirector)
    opener.open.return_value = response
    monkeypatch.setattr(audit, "build_opener", Mock(return_value=opener))

    data, digest = audit.read_json_url(url)

    assert data == {"verified": True}
    assert digest == audit.sha256(raw)
    request = cast(Request, opener.open.call_args.args[0])
    assert request.full_url == url
    opener.open.assert_called_once_with(request, timeout=20)
    response.read.assert_called_once_with(2 * 1024 * 1024 + 1)
    response.__exit__.assert_called_once()


@pytest.mark.parametrize(
    "status,changed_url,raw,message",
    [
        (503, False, b"{}", "redirected or failed"),
        (200, True, b"{}", "redirected or failed"),
        (200, False, b"[]", "Invalid advisory response"),
        (200, False, b"null", "Invalid advisory response"),
        (200, False, b"x" * (2 * 1024 * 1024 + 1), "too large"),
    ],
    ids=["http-error", "changed-url", "array", "null", "oversized"],
)
def test_fetch_rejects_invalid_response(
    status: int,
    changed_url: bool,
    raw: bytes,
    message: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = f"https://api.github.com/advisories/{GHSA}"
    response = MagicMock(
        status=status, url="https://example.test" if changed_url else url
    )
    response.__enter__.return_value = response
    response.read.return_value = raw
    opener = Mock(spec=OpenerDirector)
    opener.open.return_value = response
    monkeypatch.setattr(audit, "build_opener", Mock(return_value=opener))

    with pytest.raises(audit.AuditError, match=message):
        audit.read_json_url(url)
    response.__exit__.assert_called_once()


@pytest.mark.parametrize("code", [301, 302, 303, 307, 308])
@pytest.mark.parametrize(
    "destination",
    [
        "https://example.test/private",
        f"http://api.github.com/advisories/{GHSA}",
        "https://pypi.org/pypi/uv-build/0.12.9/json",
    ],
    ids=["other-host", "http-downgrade", "approved-url"],
)
def test_fetch_blocks_redirect_before_opening_destination(
    code: int, destination: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = f"https://api.github.com/advisories/{GHSA}"
    headers = HTTPMessage()
    headers["Location"] = destination
    parent = OpenerDirector()
    follow = Mock(side_effect=AssertionError("Redirect destination was opened"))
    monkeypatch.setattr(parent, "open", follow)
    opener = Mock(spec=OpenerDirector)

    with BytesIO(b"redirect body") as response:

        def make_opener(handler: HTTPRedirectHandler) -> Mock:
            handler.add_parent(parent)
            redirect = {
                301: handler.http_error_301,
                302: handler.http_error_302,
                303: handler.http_error_303,
                307: handler.http_error_307,
                308: handler.http_error_308,
            }[code]

            def open_request(request: Request, *, timeout: int) -> object:
                assert request.full_url == url
                assert timeout == 20
                request.timeout = timeout
                return redirect(request, response, code, "redirect", headers)

            opener.open.side_effect = open_request
            return opener

        monkeypatch.setattr(audit, "build_opener", make_opener)
        with pytest.raises(audit.AuditError, match="redirected or failed"):
            audit.read_json_url(url)
        assert response.closed

    opener.open.assert_called_once()
    follow.assert_not_called()


def test_command_never_uses_shell_and_strips_audit_override_environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("UV_NO_DEV", "true")
    monkeypatch.setenv("UV_FROZEN", "true")
    monkeypatch.setenv("PIP_AUDIT_OUTPUT", "private-file")

    def execute(arguments: list[str], **options: Any) -> object:
        assert arguments == ["uv", "--version"]
        assert options["shell"] is False
        assert options["timeout"] == 120
        assert not any(key.startswith(("UV_", "PIP_AUDIT_")) for key in options["env"])
        return object()

    monkeypatch.setattr(audit.subprocess, "run", execute)
    audit.command(["uv", "--version"], tmp_path)


BUILD_URL = "https://pypi.org/pypi/uv-build/0.12.9/json"
ADVISORY_URL = f"https://api.github.com/advisories/{GHSA}"
SECOND_GHSA = "GHSA-2345-6789-cfgh"
CPU_SOURCE = "https://download.pytorch.org/whl/cpu"
REAL_READ_JSON_URL: Callable[[str], tuple[dict[str, object], str]] = audit.read_json_url


def whole_report(
    vulnerable: bool = True, extra_aliases: tuple[str, ...] = ()
) -> dict[str, object]:
    vulnerabilities = (
        [
            {
                "id": "PYSEC-2026-1",
                "aliases": [GHSA, "CVE-2026-59890", *extra_aliases],
                "fix_versions": ["2.0.0"],
            }
        ]
        if vulnerable
        else []
    )
    return {
        "dependencies": [
            {"name": "example", "version": "1.0.0", "vulns": vulnerabilities},
            {"name": "packaging", "version": "26.3", "vulns": []},
            {"name": "pip-audit", "version": "2.10.1", "vulns": []},
            {"name": "torch", "version": "2.11.0", "vulns": []},
            {"name": "uv-build", "version": "0.12.9", "vulns": []},
        ],
        "fixes": [],
    }


def installed_distribution(name: str, version: str) -> Mock:
    return Mock(
        spec=importlib.metadata.Distribution, metadata={"Name": name}, version=version
    )


@dataclass
class AuditFixture:
    root: Path
    installed: list[Mock]
    build_info: dict[str, object]
    responses: dict[str, dict[str, object]]
    version_result: subprocess.CompletedProcess[str]
    export_result: subprocess.CompletedProcess[str]
    pip_result: subprocess.CompletedProcess[str]
    inputs: dict[str, bytes]
    command: Mock = dataclass_field(default_factory=Mock)
    fetch: Mock = dataclass_field(default_factory=Mock)
    commands: list[list[str]] = dataclass_field(default_factory=list[list[str]])
    requirements: list[str] = dataclass_field(default_factory=list[str])
    mutate_input: str | None = None


@pytest.fixture
def whole_audit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> AuditFixture:
    ml = tmp_path / "ml"
    executable = ml / ".venv/Scripts/python.exe"
    executable.parent.mkdir(parents=True)
    executable.touch()
    project_text = f"""[project]
name = "autovision-ml"
version = "0.1.0"
requires-python = ">=3.14,!=3.14.1,<3.15"
[build-system]
build-backend = "uv_build"
requires = ["uv_build==0.12.9"]
[[tool.uv.index]]
url = "{SOURCE}"
[[tool.uv.index]]
url = "{CPU_SOURCE}"
"""
    packages = [
        ("example", "1.0.0", SOURCE),
        ("packaging", "26.3", SOURCE),
        ("pip-audit", "2.10.1", SOURCE),
        ("torch", "2.11.0+cpu", CPU_SOURCE),
        ("foreign", "1.0.0", SOURCE),
    ]
    lock_text = "version = 1\n" + "".join(
        f'[[package]]\nname = "{name}"\nversion = "{version}"\n'
        f'source = {{ registry = "{source}" }}\n'
        for name, version, source in packages
    )
    inputs = {
        "ml/pyproject.toml": project_text.encode("utf-8"),
        "ml/uv.lock": lock_text.encode("utf-8"),
    }
    for relative, data in inputs.items():
        (tmp_path / relative).write_bytes(data)
    exported = (
        "example==1.0.0\npackaging==26.3\npip-audit==2.10.1\n"
        "torch==2.11.0+cpu\nforeign==1.0.0; sys_platform == 'darwin'\n"
    )
    build_info: dict[str, object] = {
        "name": "uv-build",
        "version": "0.12.9",
        "requires_dist": None,
    }
    case = AuditFixture(
        root=tmp_path,
        installed=[
            installed_distribution(name, version)
            for name, version in [
                ("Example", "1.0.0"),
                ("packaging", "26.3"),
                ("pip_audit", "2.10.1"),
                ("torch", "2.11.0+cpu"),
                ("autovision-ml", "0.1.0"),
            ]
        ],
        build_info=build_info,
        responses={BUILD_URL: {"info": build_info}, ADVISORY_URL: advisory("high")},
        version_result=subprocess.CompletedProcess([], 0, "uv 0.12.9\n", ""),
        export_result=subprocess.CompletedProcess([], 0, exported, ""),
        pip_result=subprocess.CompletedProcess([], 1, json.dumps(whole_report()), ""),
        inputs=inputs,
    )
    uv = str(tmp_path / "uv.exe")

    def run_command(
        arguments: list[str], cwd: Path, timeout: int = 120
    ) -> subprocess.CompletedProcess[str]:
        assert cwd == ml
        case.commands.append(arguments.copy())
        if arguments == [uv, "--version"]:
            assert timeout == 120
            return case.version_result
        if arguments[:2] == [uv, "export"]:
            assert timeout == 120
            return case.export_result
        assert arguments[:4] == [str(executable), "-I", "-m", "pip_audit"]
        assert timeout == 300
        requirement_path = Path(arguments[arguments.index("-r") + 1])
        case.requirements.append(requirement_path.read_text(encoding="utf-8"))
        if case.mutate_input is not None:
            path = tmp_path / case.mutate_input
            path.write_bytes(path.read_bytes() + b"\n# changed during scan\n")
        return case.pip_result

    def fetch(url: str) -> tuple[dict[str, object], str]:
        data = case.responses[url]
        return data, hashlib.sha256(json.dumps(data).encode("utf-8")).hexdigest()

    def tool_version(name: str) -> str:
        return {"pip-audit": "2.10.1", "packaging": "26.3"}[name]

    def which(name: str) -> str:
        assert name == "uv"
        return uv

    case.command.side_effect = run_command
    case.fetch.side_effect = fetch
    monkeypatch.setattr(audit.sys, "executable", str(executable))
    monkeypatch.setattr(audit.sys, "argv", ["audit-python.py"])
    monkeypatch.setattr(
        audit, "__file__", str(tmp_path / "scripts/security/audit-python.py")
    )
    monkeypatch.setattr(audit.importlib.metadata, "version", tool_version)
    monkeypatch.setattr(
        audit.importlib.metadata, "distributions", lambda: case.installed
    )
    monkeypatch.setattr(audit.shutil, "which", which)
    monkeypatch.setattr(audit.tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(audit, "default_environment", lambda: ENVIRONMENT.copy())
    monkeypatch.setattr(audit, "command", case.command)
    monkeypatch.setattr(audit, "read_json_url", case.fetch)
    monkeypatch.setattr(
        audit.subprocess, "run", Mock(side_effect=AssertionError("Native command"))
    )
    monkeypatch.setattr(
        audit, "build_opener", Mock(side_effect=AssertionError("Real HTTP request"))
    )
    monkeypatch.setattr(
        socket.socket, "connect", Mock(side_effect=AssertionError("Real network"))
    )
    return case


def assert_cli_blocked(capsys: pytest.CaptureFixture[str], message: str) -> None:
    with pytest.raises(SystemExit) as stopped:
        audit.main()
    assert stopped.value.code == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "Traceback" not in captured.err
    result = json.loads(captured.err)
    assert set(result) == {"schemaVersion", "scope", "status", "error"}
    assert result["schemaVersion"] == 1
    assert result["scope"] == "C2"
    assert result["status"] == "BLOCKED"
    assert message in result["error"]


@pytest.mark.parametrize("vulnerable", [False, True], ids=["clean", "high-retained"])
@pytest.mark.parametrize(
    "build_name,requires_dist",
    [("uv-build", None), ("UV_build", []), ("uv.build", None)],
    ids=["null-dependencies", "empty-list", "canonical-name"],
)
def test_whole_audit_collects_exact_evidence_without_release_pass(
    whole_audit: AuditFixture,
    vulnerable: bool,
    build_name: str,
    requires_dist: object,
) -> None:
    case = whole_audit
    case.build_info.update(name=build_name, requires_dist=requires_dist)
    data = whole_report(vulnerable)
    case.pip_result.stdout = json.dumps(data)
    case.pip_result.returncode = int(vulnerable)

    result = audit.audit_python(case.root)

    assert result["status"] == "COLLECTED"
    assert result["scope"] == "C2"
    assert result["dependencyCount"] == 5
    assert case.requirements == [
        (
            "example==1.0.0\npackaging==26.3\npip-audit==2.10.1\n"
            "torch==2.11.0\nuv-build==0.12.9\n"
        )
    ]
    assert len(case.requirements[0].splitlines()) == result["dependencyCount"]
    assert result["inventory"] == [
        {
            "name": name,
            "version": version,
            "auditVersion": public,
            "source": source,
            "origin": origin,
        }
        for name, version, public, source, origin in [
            ("example", "1.0.0", "1.0.0", SOURCE, "uv.lock"),
            ("packaging", "26.3", "26.3", SOURCE, "uv.lock"),
            ("pip-audit", "2.10.1", "2.10.1", SOURCE, "uv.lock"),
            ("torch", "2.11.0+cpu", "2.11.0", CPU_SOURCE, "uv.lock"),
            ("uv-build", "0.12.9", "0.12.9", "build-system.requires", "pyproject.toml"),
        ]
    ]
    assert result["rawReport"] == data
    assert result["tool"] == {
        "name": "pip-audit",
        "version": "2.10.1",
        "exitCode": int(vulnerable),
        "uv": "0.12.9",
    }
    assert result["inputs"] == {
        path: hashlib.sha256(raw).hexdigest() for path, raw in case.inputs.items()
    }
    assert (
        result["exportSha256"]
        == hashlib.sha256(case.export_result.stdout.encode("utf-8")).hexdigest()
    )
    assert (
        result["rawReportSha256"]
        == hashlib.sha256(case.pip_result.stdout.encode("utf-8")).hexdigest()
    )
    assert result["buildEvidence"] == {
        "url": BUILD_URL,
        "sha256": hashlib.sha256(
            json.dumps(case.responses[BUILD_URL]).encode("utf-8")
        ).hexdigest(),
        "metadata": case.build_info,
    }
    if vulnerable:
        assert result["findings"] == [
            {
                "ecosystem": "pypi",
                "package": "example",
                "version": "1.0.0",
                "auditVersion": "1.0.0",
                "id": GHSA,
                "aliases": sorted([GHSA, "CVE-2026-59890", "PYSEC-2026-1"]),
                "severity": "high",
                "fixVersions": ["2.0.0"],
                "url": ADVISORY_URL,
            }
        ]
        assert result["severityEvidence"] == [
            {
                "url": ADVISORY_URL,
                "sha256": hashlib.sha256(
                    json.dumps(case.responses[ADVISORY_URL]).encode("utf-8")
                ).hexdigest(),
                "advisory": case.responses[ADVISORY_URL],
            }
        ]
    else:
        assert result["findings"] == []
        assert result["severityEvidence"] == []
    assert [call.args[0] for call in case.fetch.call_args_list] == (
        [BUILD_URL, ADVISORY_URL] if vulnerable else [BUILD_URL]
    )
    assert {
        path: (case.root / path).read_bytes() for path in case.inputs
    } == case.inputs
    ml = case.root / "ml"
    executable = str(ml / ".venv/Scripts/python.exe")
    uv = str(case.root / "uv.exe")
    requirements_path = case.commands[2][5]
    assert not Path(requirements_path).exists()
    assert case.commands == [
        [uv, "--version"],
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
            executable,
        ],
        [
            executable,
            "-I",
            "-m",
            "pip_audit",
            "-r",
            requirements_path,
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
            str(Path(requirements_path).parent / "cache"),
            "--output",
            "stdout",
        ],
    ]
    assert not {"--fix", "install", "sync"}.intersection(
        argument for arguments in case.commands for argument in arguments
    )


def test_whole_audit_cli_serializes_high_as_collected_not_pass(
    whole_audit: AuditFixture, capsys: pytest.CaptureFixture[str]
) -> None:
    audit.main()
    captured = capsys.readouterr()
    assert captured.err == ""
    result = json.loads(captured.out)
    assert result["status"] == "COLLECTED"
    assert result["findings"][0]["severity"] == "high"
    assert whole_audit.command.call_count == 3


@pytest.mark.parametrize(
    "stdout,returncode",
    [("uv 0.12.8", 0), ("uv 0.12.9", 1), ("", 0)],
    ids=["wrong-version", "version-command-failed", "missing-version"],
)
def test_whole_audit_uv_version_failure_stops_before_export_and_network(
    whole_audit: AuditFixture,
    capsys: pytest.CaptureFixture[str],
    stdout: str,
    returncode: int,
) -> None:
    whole_audit.version_result.stdout = stdout
    whole_audit.version_result.returncode = returncode
    assert_cli_blocked(capsys, "uv 0.12.9 required")
    assert whole_audit.command.call_count == 1
    whole_audit.fetch.assert_not_called()


def test_whole_audit_export_failure_stops_before_network(
    whole_audit: AuditFixture, capsys: pytest.CaptureFixture[str]
) -> None:
    whole_audit.export_result.returncode = 1
    assert_cli_blocked(capsys, "uv locked export failed; no relock attempted")
    assert whole_audit.command.call_count == 2
    whole_audit.fetch.assert_not_called()


@pytest.mark.parametrize(
    "failure",
    [
        "missing",
        "missing-dependency",
        "extra",
        "wrong-version",
        "duplicate-identical",
        "duplicate-conflicting",
        "duplicate-canonical",
    ],
)
def test_whole_audit_installed_mismatch_stops_before_network(
    whole_audit: AuditFixture, capsys: pytest.CaptureFixture[str], failure: str
) -> None:
    installed = whole_audit.installed
    if failure == "missing":
        installed.pop()
    elif failure == "missing-dependency":
        installed.pop(0)
    elif failure == "extra":
        installed.append(installed_distribution("extra", "1.0.0"))
    elif failure == "wrong-version":
        installed[3] = installed_distribution("torch", "2.11.0")
    else:
        name = "PIP.AUDIT" if failure == "duplicate-canonical" else "pip_audit"
        version = "0.0.1" if failure == "duplicate-conflicting" else "2.10.1"
        # Put the conflicting entry first: a dict comprehension would hide it.
        installed.insert(0, installed_distribution(name, version))
    message = (
        "Duplicate installed distribution"
        if failure.startswith("duplicate")
        else "Installed environment differs"
    )
    assert_cli_blocked(capsys, message)
    assert whole_audit.command.call_count == 2
    whole_audit.fetch.assert_not_called()


@pytest.mark.parametrize(
    "returncode,stdout,message",
    [
        (2, json.dumps(whole_report()), "pip-audit failed or timed out"),
        (0, "{", "Expecting property name"),
        (0, json.dumps(whole_report()), "exit code and results disagree"),
        (1, json.dumps(whole_report(False)), "exit code and results disagree"),
    ],
    ids=["return-2", "malformed-json", "zero-with-finding", "one-without-finding"],
)
def test_whole_audit_pip_failures_never_become_collected(
    whole_audit: AuditFixture,
    capsys: pytest.CaptureFixture[str],
    returncode: int,
    stdout: str,
    message: str,
) -> None:
    whole_audit.pip_result.returncode = returncode
    whole_audit.pip_result.stdout = stdout
    assert_cli_blocked(capsys, message)
    assert whole_audit.command.call_count == 3
    expected_urls = [BUILD_URL]
    if returncode == 0 and stdout == json.dumps(whole_report()):
        expected_urls.append(ADVISORY_URL)
    assert [call.args[0] for call in whole_audit.fetch.call_args_list] == expected_urls


@pytest.mark.parametrize("path", ["ml/pyproject.toml", "ml/uv.lock"])
def test_whole_audit_rejects_input_byte_mutation(
    whole_audit: AuditFixture, capsys: pytest.CaptureFixture[str], path: str
) -> None:
    whole_audit.mutate_input = path
    assert_cli_blocked(capsys, "Python audit inputs changed during scan")
    assert (whole_audit.root / path).read_bytes() == (
        whole_audit.inputs[path] + b"\n# changed during scan\n"
    )
    assert whole_audit.command.call_count == 3


@pytest.mark.parametrize("field_name", ["info", "name", "version", "requires_dist"])
def test_whole_audit_rejects_missing_build_metadata(
    whole_audit: AuditFixture,
    capsys: pytest.CaptureFixture[str],
    field_name: str,
) -> None:
    if field_name == "info":
        whole_audit.responses[BUILD_URL].pop(field_name)
    else:
        whole_audit.build_info.pop(field_name)
    assert_cli_blocked(capsys, "Build backend")
    assert whole_audit.command.call_count == 2
    whole_audit.fetch.assert_called_once_with(BUILD_URL)


@pytest.mark.parametrize(
    "field_name,value",
    [
        ("info", None),
        ("info", False),
        ("info", []),
        ("info", "uv-build"),
        ("info", {}),
        ("name", "other"),
        ("name", None),
        ("name", False),
        ("name", {}),
        ("name", []),
        ("name", "uv-build "),
        ("version", "0.12.8"),
        ("version", "0.12.9.0"),
        ("version", None),
        ("version", False),
        ("version", {}),
        ("requires_dist", False),
        ("requires_dist", {}),
        ("requires_dist", ""),
        ("requires_dist", 0),
        ("requires_dist", ["example==1.0.0"]),
        ("requires_dist", [None]),
    ],
    ids=[
        "info-null",
        "info-false",
        "info-array",
        "info-string",
        "info-empty",
        "wrong-name",
        "name-null",
        "name-false",
        "name-object",
        "name-array",
        "name-space",
        "wrong-version",
        "equivalent-not-exact-version",
        "version-null",
        "version-false",
        "version-object",
        "dependencies-false",
        "dependencies-object",
        "dependencies-string",
        "dependencies-zero",
        "dependencies-nonempty",
        "dependencies-null-entry",
    ],
)
def test_whole_audit_rejects_malformed_build_metadata_before_pip(
    whole_audit: AuditFixture,
    capsys: pytest.CaptureFixture[str],
    field_name: str,
    value: object,
) -> None:
    if field_name == "info":
        whole_audit.responses[BUILD_URL]["info"] = value
    else:
        whole_audit.build_info[field_name] = value
    assert_cli_blocked(capsys, "Build backend")
    assert whole_audit.command.call_count == 2
    whole_audit.fetch.assert_called_once_with(BUILD_URL)


@pytest.mark.parametrize("url", [BUILD_URL, ADVISORY_URL], ids=["build", "severity"])
@pytest.mark.parametrize("stage", ["open", "read"])
@pytest.mark.parametrize("incomplete", [False, True], ids=["http", "incomplete-read"])
def test_whole_audit_http_exception_is_blocked_exit_two_without_traceback(
    whole_audit: AuditFixture,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    url: str,
    stage: str,
    incomplete: bool,
) -> None:
    error = IncompleteRead(b"partial", 20) if incomplete else HTTPException("broken")
    responses: list[MagicMock] = []

    def open_request(request: Request, *, timeout: int) -> MagicMock:
        assert timeout == 20
        requested_url = request.full_url
        if requested_url == url and stage == "open":
            raise error
        response = MagicMock(status=200, url=requested_url)
        response.__enter__.return_value = response
        if requested_url == url:
            response.read.side_effect = error
        else:
            response.read.return_value = json.dumps(
                whole_audit.responses[requested_url]
            ).encode("utf-8")
        responses.append(response)
        return response

    opener = Mock(spec=OpenerDirector)
    opener.open.side_effect = open_request
    monkeypatch.setattr(audit, "build_opener", Mock(return_value=opener))
    whole_audit.fetch.side_effect = REAL_READ_JSON_URL

    assert_cli_blocked(capsys, "Advisory HTTP response failed")

    assert whole_audit.command.call_count == (2 if url == BUILD_URL else 3)
    assert [call.args[0] for call in whole_audit.fetch.call_args_list] == (
        [BUILD_URL] if url == BUILD_URL else [BUILD_URL, ADVISORY_URL]
    )
    for response in responses:
        response.__exit__.assert_called_once()
    with pytest.raises(audit.AuditError) as converted:
        REAL_READ_JSON_URL(url)
    assert converted.value.__cause__ is error


@pytest.mark.parametrize(
    "first,second,selected",
    [
        ("low", "critical", SECOND_GHSA),
        ("critical", "high", GHSA),
        ("high", "unknown", None),
        ("unknown", "critical", None),
    ],
    ids=["second-maximum", "first-maximum", "unknown-second", "unknown-first"],
)
def test_whole_audit_multiple_ghsas_keep_maximum_and_reject_any_unknown(
    whole_audit: AuditFixture,
    capsys: pytest.CaptureFixture[str],
    first: str,
    second: str,
    selected: str | None,
) -> None:
    case = whole_audit
    second_url = f"https://api.github.com/advisories/{SECOND_GHSA}"
    case.responses[ADVISORY_URL]["severity"] = first
    case.responses[second_url] = {**advisory(second), "ghsa_id": SECOND_GHSA}
    case.pip_result.stdout = json.dumps(whole_report(extra_aliases=(SECOND_GHSA,)))
    if selected is None:
        assert_cli_blocked(capsys, "Unknown reviewed severity")
    else:
        result = audit.audit_python(case.root)
        assert result["status"] == "COLLECTED"
        assert len(result["findings"]) == 1
        assert result["findings"][0]["id"] == selected
        assert result["findings"][0]["severity"] == "critical"
        assert result["findings"][0]["aliases"] == sorted(
            [GHSA, SECOND_GHSA, "CVE-2026-59890", "PYSEC-2026-1"]
        )
        assert {item["url"] for item in result["severityEvidence"]} == {
            ADVISORY_URL,
            second_url,
        }
        assert case.fetch.call_count == 3
