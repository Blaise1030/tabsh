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
        send({"jsonrpc": "2.0", "id": mid, "result": {"sessionId": "fake-session-1"}})
    elif method == "session/prompt":
        sid = params.get("sessionId", "")
        text = "".join(
            c.get("text", "") for c in params.get("prompt", []) if c.get("type") == "text"
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
