from __future__ import annotations

import json

import pytest

from autovision_ml.protocol import (
    MAX_WORKER_MESSAGE_BYTES,
    WorkerCorrelation,
    encode_worker_cancel,
    encode_worker_event,
    encode_worker_request,
    parse_worker_cancel_line,
    parse_worker_event_line,
    parse_worker_request,
)

# Same fixed wire fixtures as worker.test.ts; no subprocess or runtime discovery.
JOB_ID = "ae45cf74-c9f9-4c49-88b9-0523b1ac7383"
PROJECT_ID = "01234567-89ab-4cde-8f01-23456789abcd"
EXPECTED: WorkerCorrelation = {"jobId": JOB_ID, "projectId": PROJECT_ID}
HEADER: dict[str, object] = {"schemaVersion": 1, **EXPECTED}
REQUEST = (
    '{"schemaVersion":1,"jobId":"ae45cf74-c9f9-4c49-88b9-0523b1ac7383",'
    '"projectId":"01234567-89ab-4cde-8f01-23456789abcd","kind":"scan-dataset",'
    '"payload":{"label":"日本語🌱","items":[1,0.5,true,null]}}'
)
PROGRESS = (
    '{"schemaVersion":1,"jobId":"ae45cf74-c9f9-4c49-88b9-0523b1ac7383",'
    '"projectId":"01234567-89ab-4cde-8f01-23456789abcd","type":"progress",'
    '"source":"actual","processed":0,"total":null}\n'
)
CANCEL = (
    '{"schemaVersion":1,"jobId":"ae45cf74-c9f9-4c49-88b9-0523b1ac7383",'
    '"projectId":"01234567-89ab-4cde-8f01-23456789abcd","type":"cancel"}\n'
)
ID_FIXTURES: list[tuple[str, str, str]] = [
    (
        "upper-max",
        "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ),
    (
        "mixed-max",
        "FfFfFfFf-FfFf-FfFf-FfFf-FfFfFfFfFfFf",
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ),
    (
        "nil",
        "00000000-0000-0000-0000-000000000000",
        "00000000-0000-0000-0000-000000000000",
    ),
    ("upper-regular", "AE45CF74-C9F9-4C49-88B9-0523B1AC7383", JOB_ID),
    ("mixed-regular", "aE45Cf74-C9f9-4c49-88B9-0523B1Ac7383", JOB_ID),
    (
        "lower-max",
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ),
    ("lower-regular", JOB_ID, JOB_ID),
]


def test_fixed_unicode_fixtures_and_crlf() -> None:
    assert encode_worker_request(parse_worker_request(REQUEST)) == REQUEST
    assert encode_worker_event(parse_worker_event_line(PROGRESS, EXPECTED)) == PROGRESS
    assert parse_worker_request(REQUEST.encode()) == parse_worker_request(REQUEST)
    assert parse_worker_event_line(PROGRESS.replace("\n", "\r\n"), EXPECTED)


def test_escaped_surrogate_pairs_in_payloads_and_manifests() -> None:
    escaped = REQUEST.replace("🌱", "\\ud83c\\udf31")
    for source in (escaped, escaped.encode()):
        assert encode_worker_request(parse_worker_request(source)) == REQUEST
    event = {**HEADER, "type": "completed", "resultManifest": "🌱.json"}
    canonical = json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"
    escaped_line = canonical.replace("🌱", "\\ud83c\\udf31")
    parsed = parse_worker_event_line(escaped_line, EXPECTED)
    assert parsed == event
    assert encode_worker_event(parsed) == canonical


@pytest.mark.parametrize("kind", ["scan-dataset", "assist", "train"])
def test_planned_commands_and_normalized_ids(kind: str) -> None:
    value = parse_worker_request(
        json.dumps({**HEADER, "jobId": JOB_ID.upper(), "kind": kind, "payload": {}})
    )
    assert value["kind"] == kind
    assert value["jobId"] == JOB_ID


@pytest.mark.parametrize(
    ("_case", "supplied_id", "normalized_id"),
    ID_FIXTURES,
    ids=[case[0] for case in ID_FIXTURES],
)
def test_normalized_ids_in_messages_and_expected_correlations(
    _case: str, supplied_id: str, normalized_id: str
) -> None:
    correlations: list[tuple[WorkerCorrelation, WorkerCorrelation]] = [
        (
            {**EXPECTED, "jobId": supplied_id},
            {**EXPECTED, "jobId": normalized_id},
        ),
        (
            {**EXPECTED, "projectId": supplied_id},
            {**EXPECTED, "projectId": normalized_id},
        ),
    ]
    base: dict[str, object] = {**HEADER, "kind": "train", "payload": {}}
    for supplied, normalized in correlations:
        value = {**base, **supplied}
        canonical_request = {**value, **normalized}
        assert parse_worker_request(json.dumps(value)) == canonical_request
        assert encode_worker_request(value) == json.dumps(
            canonical_request, separators=(",", ":")
        )
        event = {**HEADER, **supplied, "type": "started"}
        canonical_event = {**event, **normalized}
        event_line = json.dumps(event, separators=(",", ":")) + "\n"
        canonical_event_line = json.dumps(canonical_event, separators=(",", ":")) + "\n"
        control = {**HEADER, **supplied, "type": "cancel"}
        canonical_control = {**control, **normalized}
        control_line = json.dumps(control, separators=(",", ":")) + "\n"
        canonical_control_line = (
            json.dumps(canonical_control, separators=(",", ":")) + "\n"
        )
        assert encode_worker_event(event) == canonical_event_line
        assert encode_worker_cancel(control) == canonical_control_line
        for identity in (supplied, normalized):
            for line in (event_line, canonical_event_line):
                assert parse_worker_event_line(line, identity) == canonical_event
            for line in (control_line, canonical_control_line):
                assert parse_worker_cancel_line(line, identity) == canonical_control


def test_invalid_ids_in_messages_and_expected_correlations() -> None:
    invalid_ids = [
        "not-a-uuid",
        "ae45cf74-c9f9-0c49-88b9-0523b1ac7383",
        "ae45cf74-c9f9-4c49-78b9-0523b1ac7383",
        "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFE",
        "00000000-0000-0000-0000-000000000001",
        JOB_ID + "\n",
        JOB_ID + " ",
        JOB_ID[:-1],
    ]
    base: dict[str, object] = {**HEADER, "kind": "train", "payload": {}}
    for invalid_id in invalid_ids:
        identities: list[WorkerCorrelation] = [
            {**EXPECTED, "jobId": invalid_id},
            {**EXPECTED, "projectId": invalid_id},
        ]
        for identity in identities:
            value = {**base, **identity}
            event = {**HEADER, **identity, "type": "started"}
            control = {**HEADER, **identity, "type": "cancel"}
            with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
                parse_worker_request(json.dumps(value))
            with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
                encode_worker_request(value)
            with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
                parse_worker_event_line(json.dumps(event) + "\n", EXPECTED)
            with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
                encode_worker_event(event)
            with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
                parse_worker_cancel_line(json.dumps(control) + "\n", EXPECTED)
            with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
                encode_worker_cancel(control)
            with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
                parse_worker_event_line(PROGRESS, identity)
            with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
                parse_worker_cancel_line(CANCEL, identity)


@pytest.mark.parametrize(
    "fields",
    [
        {"type": "started"},
        {"type": "warning", "code": "CANCELLED"},
        {"type": "completed", "resultManifest": "result.json"},
        {"type": "failed", "code": "READ_FAILED"},
    ],
)
def test_exact_event_fields(fields: dict[str, object]) -> None:
    event = {**HEADER, **fields}
    assert parse_worker_event_line(encode_worker_event(event), EXPECTED) == event
    with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
        encode_worker_event({**event, "extra": 1})


def test_cancel_and_both_correlation_ids() -> None:
    control = {**HEADER, "type": "cancel"}
    line = encode_worker_cancel(control)
    assert parse_worker_cancel_line(line, EXPECTED) == control
    with pytest.raises(ValueError):
        parse_worker_event_line(line, EXPECTED)
    identities: list[WorkerCorrelation] = [
        {**EXPECTED, "jobId": PROJECT_ID},
        {**EXPECTED, "projectId": JOB_ID},
    ]
    for identity in identities:
        with pytest.raises(ValueError):
            parse_worker_event_line(PROGRESS, identity)
        with pytest.raises(ValueError):
            parse_worker_cancel_line(line, identity)


@pytest.mark.parametrize(
    ("processed", "total", "accepted"),
    [
        (0, 0, True),
        (1, 2, True),
        (5, None, True),
        (1, 0, False),
        (-1, 2, False),
        (0.5, 2, False),
        (True, 2, False),
        (False, 2, False),
        (1, False, False),
        (1, float("inf"), False),
        (float("nan"), None, False),
        (9007199254740992, None, False),
    ],
)
def test_actual_counts(processed: object, total: object, accepted: bool) -> None:
    event = {
        **HEADER,
        "type": "progress",
        "source": "actual",
        "processed": processed,
        "total": total,
    }
    if accepted:
        assert encode_worker_event(event).endswith("\n")
    else:
        with pytest.raises(ValueError):
            encode_worker_event(event)


@pytest.mark.parametrize("number", ["1.0", "1e0"])
def test_integer_protocol_fields_normalize_to_canonical_one(number: str) -> None:
    numeric_request = REQUEST.replace('"schemaVersion":1', f'"schemaVersion":{number}')
    request = parse_worker_request(numeric_request)
    assert type(request["schemaVersion"]) is int
    assert encode_worker_request(request) == REQUEST
    canonical_progress = PROGRESS.replace(
        '"processed":0,"total":null', '"processed":1,"total":1'
    )
    numeric_progress = canonical_progress.replace(
        '"schemaVersion":1', f'"schemaVersion":{number}'
    )
    numeric_progress = numeric_progress.replace(
        '"processed":1,"total":1', f'"processed":{number},"total":{number}'
    )
    event = parse_worker_event_line(numeric_progress, EXPECTED)
    assert event["type"] == "progress"
    assert type(event["processed"]) is int
    assert type(event["total"]) is int
    assert event["processed"] == event["total"] == 1
    assert encode_worker_event(event) == canonical_progress
    numeric_cancel = CANCEL.replace('"schemaVersion":1', f'"schemaVersion":{number}')
    control = parse_worker_cancel_line(numeric_cancel, EXPECTED)
    assert type(control["schemaVersion"]) is int
    assert encode_worker_cancel(control) == CANCEL
    # Payload numbers are compared semantically, not byte-for-byte across codecs.
    numeric_payload = REQUEST.replace('"items":[1,', f'"items":[{number},')
    value = parse_worker_request(numeric_payload)
    assert value["payload"] == parse_worker_request(REQUEST)["payload"]
    assert parse_worker_request(encode_worker_request(value)) == value


def test_false_is_payload_data_not_a_protocol_integer() -> None:
    false_payload = REQUEST.replace("true", "false")
    assert encode_worker_request(parse_worker_request(false_payload)) == false_payload
    false_request = REQUEST.replace('"schemaVersion":1', '"schemaVersion":false')
    with pytest.raises(ValueError):
        parse_worker_request(false_request)
    invalid_request: dict[str, object] = {
        **HEADER,
        "schemaVersion": False,
        "kind": "train",
        "payload": {},
    }
    with pytest.raises(ValueError):
        encode_worker_request(invalid_request)
    for line in [
        PROGRESS.replace('"schemaVersion":1', '"schemaVersion":false'),
        PROGRESS.replace('"processed":0', '"processed":false'),
        PROGRESS.replace('"total":null', '"total":false'),
    ]:
        with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
            parse_worker_event_line(line, EXPECTED)
    with pytest.raises(ValueError):
        encode_worker_event({**HEADER, "schemaVersion": False, "type": "started"})
    with pytest.raises(ValueError):
        parse_worker_cancel_line(
            CANCEL.replace('"schemaVersion":1', '"schemaVersion":false'), EXPECTED
        )
    with pytest.raises(ValueError):
        encode_worker_cancel({**HEADER, "schemaVersion": False, "type": "cancel"})


@pytest.mark.parametrize(
    "source",
    [
        "",
        "{}",
        "[]",
        REQUEST + "{}",
        "\ufeff" + REQUEST,
        REQUEST.replace('"schemaVersion":1', '"schemaVersion":true'),
        REQUEST.replace('"schemaVersion":1', '"schemaVersion":2'),
        REQUEST.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
        REQUEST.replace('"label":', '"label":0,"\\u006cabel":'),
        REQUEST.replace("0.5", "NaN"),
        REQUEST.replace("0.5", "Infinity"),
        REQUEST.replace("0.5", "1e400"),
        REQUEST.replace("0.5", "9007199254740992"),
        REQUEST.replace("scan-dataset", "health"),
        REQUEST.replace("日本語🌱", "\\ud800"),
    ],
    ids=[f"invalid-{index}" for index in range(15)],
)
def test_malformed_json(source: str) -> None:
    with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
        parse_worker_request(source)


def test_line_framing_and_utf8() -> None:
    lines: list[str | bytes] = [
        PROGRESS.rstrip(),
        PROGRESS + PROGRESS,
        "\n",
        PROGRESS + "\n",
        b"\xff\n",
    ]
    for line in lines:
        with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
            parse_worker_event_line(line, EXPECTED)


def test_utf8_bom_bytes_are_rejected_in_all_message_types() -> None:
    bom = b"\xef\xbb\xbf"
    with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
        parse_worker_request(bom + REQUEST.encode())
    with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
        parse_worker_event_line(bom + PROGRESS.encode(), EXPECTED)
    with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
        parse_worker_cancel_line(bom + CANCEL.encode(), EXPECTED)


@pytest.mark.parametrize(("depth", "accepted"), [(64, True), (65, False)])
def test_normal_request_nesting_boundary(depth: int, accepted: bool) -> None:
    # The request envelope and payload object account for two container levels.
    nested: object = 0
    for _ in range(depth - 2):
        nested = [nested]
    value = {**HEADER, "kind": "train", "payload": {"nested": nested}}
    source = json.dumps(value, separators=(",", ":"))
    if accepted:
        assert parse_worker_request(source) == value
        assert encode_worker_request(value) == source
    else:
        with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
            parse_worker_request(source)
        with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
            encode_worker_request(value)


def test_bounds_and_invalid_encoding_are_silent(
    capsys: pytest.CaptureFixture[str],
) -> None:
    base: dict[str, object] = {**HEADER, "kind": "train", "payload": {}}
    payloads: list[object] = [
        list[object](),
        {"value": object()},
        {"value": float("inf")},
        {"value": "\ud800"},
    ]
    for payload in payloads:
        with pytest.raises(ValueError):
            encode_worker_request({**base, "payload": payload})
    exact = REQUEST + " " * (MAX_WORKER_MESSAGE_BYTES - len(REQUEST.encode()))
    assert parse_worker_request(exact)
    with pytest.raises(ValueError):
        parse_worker_request(exact + " ")
    invalid_events: list[dict[str, object]] = [
        {"type": "failed", "code": "C:\\private\\image.png"},
        {
            "type": "progress",
            "source": "estimated",
            "processed": 0,
            "total": None,
        },
    ]
    for fields in invalid_events:
        with pytest.raises(ValueError, match="^Invalid worker protocol message$"):
            encode_worker_event({**HEADER, **fields})
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""
