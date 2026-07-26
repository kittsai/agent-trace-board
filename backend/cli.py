"""Agent Trace Viewer CLI。"""

from __future__ import annotations

import argparse
import sys


def main():
    parser = argparse.ArgumentParser(
        prog="atv",
        description="Agent Trace Viewer — Coding Agent 的执行过程录像机",
    )
    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    # serve
    serve_parser = subparsers.add_parser("serve", help="启动服务")
    serve_parser.add_argument("--port", type=int, default=8080, help="端口号")
    serve_parser.add_argument("--host", default="0.0.0.0", help="监听地址")

    # list
    list_parser = subparsers.add_parser("list", help="列出所有 session")
    list_parser.add_argument("--status", help="过滤状态")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    if args.command == "serve":
        cmd_serve(args.host, args.port)
    elif args.command == "list":
        cmd_list(args.status)


def cmd_serve(host: str, port: int):
    """启动服务。"""
    import uvicorn

    print(f"🚀 Agent Trace Viewer 启动中...")
    print(f"   地址: http://{host}:{port}")
    print(f"   API:  http://{host}:{port}/api/health")
    print()

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
    )


def cmd_list(status_filter: str | None):
    """列出所有 session。"""
    from services.session_service import SessionService

    service = SessionService()
    sessions = service.list_sessions(status=status_filter)

    if not sessions:
        print("没有找到 session。")
        return

    print(f"共 {len(sessions)} 个 session:\n")
    for s in sessions:
        status_icon = "🟢" if s["status"] == "active" else "⚪"
        title = s.get("title") or s["id"][:8] + "..."
        print(f"  {status_icon} {title:<40} {s['agent']:<12} {s['status']}")


if __name__ == "__main__":
    main()
