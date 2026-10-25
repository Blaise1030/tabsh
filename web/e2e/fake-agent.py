#!/usr/bin/env python3
"""Minimal ACP agent for e2e. Same stdio shape as src/chat/acp.rs's fake agent."""
import json
import sys


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def update(session_id, upd):
    send(
        {
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {"sessionId": session_id, "update": upd},
        }
    )


MODE = {"current": "ask"}
MODEL = {"current": "fast"}


def mode_options():
    return [
        {
            "id": "mode",
            "name": "Session Mode",
            "category": "mode",
            "currentValue": MODE["current"],
            "options": [
                {"value": "ask", "name": "Ask", "description": "Request permission before making changes"},
                {"value": "code", "name": "Code", "description": "Write and modify code with full tool access"},
            ],
        }
    ]


def model_options():
    return [
        {
            "id": "model",
            "name": "Model",
            "category": "model",
            "currentValue": MODEL["current"],
            "options": [
                {"value": "fast", "name": "Fast"},
                {"value": "smart", "name": "Smart"},
                {"value": "claude-sonnet-4-5", "name": "Claude Sonnet 4.5"},
                {"value": "gpt-5", "name": "GPT-5"},
            ],
        }
    ]


def config_options():
    return mode_options() + model_options()


while True:
    line = sys.stdin.readline()
    if not line:
        break
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    method = msg.get("method")
    mid = msg.get("id")
    params = msg.get("params") or {}
    if method == "initialize":
        send(
            {
                "jsonrpc": "2.0",
                "id": mid,
                "result": {
                    "protocolVersion": 1,
                    "agentCapabilities": {},
                    "agentInfo": {"name": "fake-agent", "version": "0.1.0"},
                    "authMethods": [],
                },
            }
        )
    elif method == "session/new":
        send(
            {
                "jsonrpc": "2.0",
                "id": mid,
                "result": {"sessionId": "fake-session-1", "configOptions": config_options()},
            }
        )
    elif method == "session/set_config_option":
        if params.get("configId") == "mode":
            MODE["current"] = params.get("value") or MODE["current"]
        if params.get("configId") == "model":
            MODEL["current"] = params.get("value") or MODEL["current"]
        send(
            {
                "jsonrpc": "2.0",
                "id": mid,
                "result": {"configOptions": config_options()},
            }
        )
    elif method == "session/prompt":
        sid = params.get("sessionId", "")
        text = "".join(
            c.get("text", "") for c in params.get("prompt", []) if c.get("type") == "text"
        )
        if "slow" in text:
            update(
                sid,
                {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": "slow started"},
                },
            )
            while True:
                nxt = sys.stdin.readline()
                if not nxt:
                    break
                if json.loads(nxt).get("method") == "session/cancel":
                    break
            send({"jsonrpc": "2.0", "id": mid, "result": {"stopReason": "cancelled"}})
            continue
        if "permission" in text:
            send(
                {
                    "jsonrpc": "2.0",
                    "id": 9000,
                    "method": "session/request_permission",
                    "params": {
                        "sessionId": sid,
                        "toolCall": {"toolCallId": "tc-1", "title": "Fake tool"},
                        "options": [
                            {"optionId": "allow", "name": "Allow", "kind": "allow_once"},
                            {"optionId": "deny", "name": "Deny", "kind": "reject_once"},
                        ],
                    },
                }
            )
            resp = json.loads(sys.stdin.readline() or "{}")
            outcome = (resp.get("result") or {}).get("outcome") or {}
            if outcome.get("outcome") == "selected":
                outcome_text = "selected:" + str(outcome.get("optionId"))
            else:
                outcome_text = str(outcome.get("outcome", "unknown"))
            update(
                sid,
                {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {
                        "type": "text",
                        "text": "permission outcome: " + outcome_text,
                    },
                },
            )
        update(
            sid,
            {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "fake reply: " + text},
            },
        )
        send({"jsonrpc": "2.0", "id": mid, "result": {"stopReason": "end_turn"}})
    elif method == "session/cancel":
        pass
    elif mid is not None:
        send(
            {
                "jsonrpc": "2.0",
                "id": mid,
                "error": {"code": -32601, "message": "unknown method"},
            }
        )
