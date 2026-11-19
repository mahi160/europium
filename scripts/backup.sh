#!/bin/sh
set +x
set -eu
. ./scripts/operations.sh
begin
configure_backup
backup_run
