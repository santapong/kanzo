#!/usr/bin/env python3
"""Exercise the native HTTP/MCP boundary against an owned temporary board."""
import argparse
import json
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import urlencode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True)
    args = parser.parse_args()
    binary = str(Path(args.binary).resolve())
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    checks = []

    def request(method, path, body=None, expected=200, headers=None, raw=False):
        h = {"Content-Type": "application/json", **(headers or {})}
        r = Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                    headers=h, method=method)
        try:
            with urlopen(r, timeout=5) as reply:
                status, data, response_headers = reply.status, reply.read(), reply.headers
        except HTTPError as error:
            status, data, response_headers = error.code, error.read(), error.headers
        assert status == expected, (method, path, status, expected, data[:400])
        if raw:
            return data, response_headers
        return json.loads(data) if data else None

    def check(label):
        checks.append(label)

    with tempfile.TemporaryDirectory(prefix="kanzo-http-") as folder:
        log_path = Path(folder) / "server.log"
        with log_path.open("w+") as log:
            proc = subprocess.Popen([binary, "--home", folder, "--port", str(port), "--no-open"],
                                    stdout=log, stderr=log)
            try:
                for _ in range(100):
                    if proc.poll() is not None:
                        log.seek(0)
                        raise AssertionError("server exited: " + log.read()[-3000:])
                    try:
                        with urlopen(base + "/api/ping", timeout=1) as reply:
                            if reply.read() == b"kanzo":
                                break
                    except OSError:
                        time.sleep(.05)
                else:
                    raise AssertionError("server readiness deadline")
                request("POST", "/api/projects", {"slug": "demo", "name": "Demo"})
                request("POST", "/api/projects", {"slug": "archived", "name": "Archived"})
                profile = request("GET", "/api/projects/demo/profile")
                profile.update(goal="A reproducible synthetic task", category="Engineering",
                               skills=["skills/review/SKILL.md"], memories=["notes/checkpoint.md"])
                request("PUT", "/api/projects/demo/profile", profile)
                assert request("GET", "/api/projects/demo/profile")["goal"] == profile["goal"]
                hidden = request("GET", "/api/projects/archived/profile")
                hidden["visibility"] = "inactive"
                request("PUT", "/api/projects/archived/profile", hidden)
                check("profile persistence and native organization")

                parent = request("POST", "/api/tasks", {"project": "demo", "title": "Parent"})
                dependency = request("POST", "/api/tasks", {"project": "demo", "title": "Prerequisite"})
                child = request("POST", f"/api/tasks/{parent['id']}/subtasks",
                                {"title": "Child", "description": "Independently described work"})
                p = request("GET", f"/api/tasks/{child['id']}/plan")
                assert p["parent_id"] == parent["id"]
                p.update(depends_on=[dependency["id"]], planned_start="2026-11-02",
                         planned_end="2026-11-04", due_date="2026-11-05", estimate_seconds=3600,
                         deliverable="A checked result", acceptance="Check evidence", owner="worker")
                request("PUT", f"/api/tasks/{child['id']}/plan", p)
                assert request("GET", f"/api/tasks/{child['id']}/plan")["due_date"] == "2026-11-05"
                request("PATCH", f"/api/tasks/{child['id']}", {"status": "doing"}, expected=400)
                request("POST", f"/api/tasks/{child['id']}/move", {"status": "doing"}, expected=400)
                cycle = request("GET", f"/api/tasks/{dependency['id']}/plan")
                cycle["depends_on"] = [child["id"]]
                request("PUT", f"/api/tasks/{dependency['id']}/plan", cycle, expected=400)
                parent_deadlock = dict(p, depends_on=[parent["id"]])
                request("PUT", f"/api/tasks/{child['id']}/plan", parent_deadlock, expected=400)
                invalid_date = dict(p, due_date="2026-02-30")
                request("PUT", f"/api/tasks/{child['id']}/plan", invalid_date, expected=400)
                check("real children, schedule persistence, dependency/cycle/date boundaries")

                timer = request("POST", f"/api/tasks/{dependency['id']}/timer",
                                {"actor": "human", "request_id": "timer-1"})
                duplicate = request("POST", f"/api/tasks/{dependency['id']}/timer",
                                    {"actor": "human", "request_id": "timer-1"})
                assert timer["id"] == duplicate["id"]
                request("POST", f"/api/tasks/{child['id']}/timer",
                        {"actor": "human", "request_id": "timer-2"}, expected=400)
                request("POST", f"/api/time/{timer['id']}/stop", {"actor": "different"}, expected=400)
                stopped = request("POST", f"/api/time/{timer['id']}/stop", {"actor": "human"})
                stopped_again = request("POST", f"/api/time/{timer['id']}/stop", {"actor": "human"})
                assert stopped == stopped_again and stopped["ended_at"]
                manual_body = {"actor": "human", "seconds": 1800, "note": "Reported work", "request_id": "manual-1"}
                manual = request("POST", f"/api/tasks/{dependency['id']}/time", manual_body)
                manual_duplicate = request("POST", f"/api/tasks/{dependency['id']}/time", manual_body)
                assert manual["id"] == manual_duplicate["id"] and manual["seconds"] == 1800
                assert manual.get("started_at") is None
                check("cross-tab timer uniqueness, actor ownership, idempotence and explicit manual duration")

                request("PATCH", f"/api/tasks/{dependency['id']}", {"status": "done"})
                request("PATCH", f"/api/tasks/{child['id']}", {"status": "doing"})
                request("PATCH", f"/api/tasks/{child['id']}", {"status": "done"}, expected=400)
                request("PATCH", f"/api/tasks/{child['id']}", {"status": "review"})
                request("POST", f"/api/tasks/{child['id']}/accept",
                        {"reviewer": "Fixture owner", "evidence": "Fixture checks passed"})
                request("PATCH", f"/api/tasks/{child['id']}", {"status": "done"})
                request("PATCH", f"/api/tasks/{child['id']}", {"description": "Changed deliverable"})
                assert request("GET", f"/api/tasks/{child['id']}")["task"]["status"] == "review"
                assert not request("GET", f"/api/tasks/{child['id']}/context")["accepted"]
                request("PATCH", f"/api/tasks/{child['id']}", {"status": "done"}, expected=400)
                check("human acceptance and stale-evidence completion guard")

                snapshot = request("GET", "/api/harness")
                assert str(child["id"]) in snapshot["plans"]
                assert len(snapshot["time_entries"]) == 2
                assert snapshot["events"]
                context = request("GET", f"/api/tasks/{child['id']}/context")
                context_text = json.dumps(context)
                assert profile["goal"] in context_text and "skills/review/SKILL.md" in context_text
                check("native snapshot and selected context references")

                request("PATCH", f"/api/tasks/{child['id']}", {"tags": "Research, UI"})
                request("PATCH", f"/api/tasks/{parent['id']}", {"tags": "build-ui"})
                query = urlencode({"project":"demo", "category":"Engineering", "tag":"UI",
                                   "owner":"worker", "scheduled":"yes", "limit":1})
                page = request("GET", "/api/tasks/query?" + query)
                assert page["total"] == 1 and page["tasks"][0]["id"] == child["id"]
                assert not page["has_more"]
                all_page = request("GET", "/api/tasks/query?project=demo&limit=1")
                assert all_page["total"] == 3 and all_page["has_more"]
                second_page = request("GET", "/api/tasks/query?project=demo&limit=1&offset=1")
                assert all_page["tasks"][0]["id"] != second_page["tasks"][0]["id"]
                facet = request("GET", "/api/tags?project=demo&tag=ui")
                assert {row["tag"] for row in facet["tags"]} == {"ui", "research"}
                assert request("GET", "/api/projects/demo/context")["references_only"]
                for bad in ["limit=0", "offset=10001", "status=missing", "visibility=invalid", "tag=a%2Cb"]:
                    request("GET", "/api/tasks/query?" + bad, expected=400)
                check("shared discovery filters, exact tags, full-history pagination and validation")

                request("POST", "/api/projects", {"slug": "moves", "name": "Move boundaries"})
                moving = request("POST", "/api/tasks", {"project": "moves", "title": "Accepted moving task"})
                elsewhere = request("POST", "/api/tasks", {"project": "moves", "title": "Other-column anchor"})
                deleted = request("POST", "/api/tasks", {"project": "moves", "title": "Deleted anchor"})
                tail = request("POST", "/api/tasks", {"project": "moves", "title": "Todo tail"})
                moving_plan = request("GET", f"/api/tasks/{moving['id']}/plan")
                moving_plan["acceptance"] = "Reviewed evidence"
                request("PUT", f"/api/tasks/{moving['id']}/plan", moving_plan)
                request("PATCH", f"/api/tasks/{moving['id']}", {"status": "review"})
                request("POST", f"/api/tasks/{moving['id']}/accept",
                        {"reviewer": "Fixture owner", "evidence": "Boundary fixture reviewed"})
                request("PATCH", f"/api/tasks/{elsewhere['id']}", {"status": "doing"})
                request("DELETE", f"/api/tasks/{deleted['id']}")
                unchanged_board = request("GET", "/api/board?project=moves&done=all")
                unchanged_harness = request("GET", "/api/harness")
                unchanged_context = request("GET", f"/api/tasks/{moving['id']}/context")
                assert unchanged_context["accepted"]
                for anchor in [deleted["id"], elsewhere["id"], 999999]:
                    rejected = request("POST", f"/api/tasks/{moving['id']}/move",
                                       {"status": "todo", "before": anchor}, expected=400)
                    assert "refresh the board" in rejected["error"]
                    assert request("GET", "/api/board?project=moves&done=all") == unchanged_board
                    assert request("GET", "/api/harness") == unchanged_harness
                    assert request("GET", f"/api/tasks/{moving['id']}/context") == unchanged_context
                request("POST", f"/api/tasks/{moving['id']}/move", {"status": "todo", "before": None})
                moved_board = request("GET", "/api/board?project=moves&done=all")
                assert [t["id"] for t in moved_board["tasks"] if t["status"] == "todo"] == [tail["id"], moving["id"]]
                request("POST", f"/api/tasks/{tail['id']}/move", {"status": "todo", "before": tail["id"]})
                moved_board = request("GET", "/api/board?project=moves&done=all")
                assert [t["id"] for t in moved_board["tasks"] if t["status"] == "todo"] == [moving["id"], tail["id"]]
                check("stale/deleted move anchors reject atomically; explicit append/self-anchor preserved")

                mcp_headers = {"Accept": "application/json, text/event-stream"}
                def mcp(method, params, number):
                    data, h = request("POST", "/mcp", {"jsonrpc": "2.0", "id": number,
                                                       "method": method, "params": params}, headers=mcp_headers, raw=True)
                    if h.get("Mcp-Session-Id"):
                        mcp_headers["Mcp-Session-Id"] = h["Mcp-Session-Id"]
                    text = data.decode()
                    if text.startswith("event:") or text.startswith("data:"):
                        rows = [line[5:].strip() for line in text.splitlines() if line.startswith("data:")]
                        assert rows, text[:300]
                        return json.loads(rows[-1])
                    return json.loads(text)
                initialized = mcp("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                                    "clientInfo": {"name": "kanzo-acceptance", "version": "1"}}, 1)
                assert "result" in initialized
                tools = mcp("tools/list", {}, 2)["result"]["tools"]
                assert {"get_task_context", "update_task_plan", "create_subtask", "search_tasks", "list_tags", "get_project_context"} <= {t["name"] for t in tools}
                packet = mcp("tools/call", {"name": "get_task_context", "arguments": {"id": f"demo#{child['id']}"}}, 3)
                assert not packet["result"].get("isError") and profile["goal"] in json.dumps(packet)
                result = mcp("tools/call", {"name":"search_tasks", "arguments":{"project":"demo","tag":"ui","limit":1}},4)["result"]
                assert not result.get("isError")
                assert json.loads(result["content"][0]["text"])["tasks"][0]["id"] == child["id"]
                result = mcp("tools/call", {"name":"list_tags", "arguments":{"project":"demo","tag":"ui"}},5)["result"]
                assert json.loads(result["content"][0]["text"])["total"] == 2
                result = mcp("tools/call", {"name":"get_project_context", "arguments":{"project":"demo"}},6)["result"]
                assert json.loads(result["content"][0]["text"])["profile"]["goal"] == profile["goal"]
                result = mcp("tools/call", {"name":"search_tasks", "arguments":{"limit":101}},7)["result"]
                assert result.get("isError")
                check("native HTTP MCP initialization, discovery and context tool")

                request("GET", "/api/harness", expected=403, headers={"Origin": "https://outside.example"}, raw=True)
                request("GET", "/api/harness", expected=403, headers={"Host": "outside.example"}, raw=True)
                check("retained Host and Origin protections")
                print(json.dumps({"result": "PASS", "groups": len(checks), "checks": checks,
                                  "scope": "Synthetic native HTTP/MCP; browser acceptance is separate"}, indent=2))
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)
                assert proc.poll() is not None


if __name__ == "__main__":
    main()
