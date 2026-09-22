#!/bin/bash
# R49: Go 后端 auto-restart (Go 挂了 2 秒重启)
cd "$(dirname "$0")"
while true; do ./go-backend/heis-backend; sleep 2; done
