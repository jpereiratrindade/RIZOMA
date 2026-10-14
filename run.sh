#!/usr/bin/env bash
# RIZOMA — Launcher script
# Copyright (C) 2026 José Pedro Trindade
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
exec ./build/rizoma-server --host "${RIZOMA_HOST:-127.0.0.1}" --data-dir "${RIZOMA_DATA_DIR:-./var}" --web-dir ./web --port "${RIZOMA_PORT:-8089}" "$@"
