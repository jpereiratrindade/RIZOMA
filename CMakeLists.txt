# RIZOMA — Build configuration
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

cmake_minimum_required(VERSION 3.25)

if(POLICY CMP0167)
  cmake_policy(SET CMP0167 NEW)
endif()

project(rizoma VERSION 0.2.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 26)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Threads REQUIRED)
find_package(OpenSSL REQUIRED)
find_package(SQLite3 REQUIRED)
find_package(PNG REQUIRED)
find_package(JPEG REQUIRED)
find_package(TIFF REQUIRED)
find_path(BOOST_INCLUDE_DIR NAMES boost/asio.hpp REQUIRED)

add_executable(rizoma-server src/main.cpp src/database.cpp src/analysis.cpp src/tiles.cpp)
target_include_directories(rizoma-server PRIVATE ${BOOST_INCLUDE_DIR})
target_link_libraries(rizoma-server PRIVATE Threads::Threads OpenSSL::Crypto SQLite3::SQLite3 PNG::PNG JPEG::JPEG TIFF::TIFF)
target_compile_definitions(rizoma-server PRIVATE BOOST_ERROR_CODE_HEADER_ONLY BOOST_SYSTEM_NO_DEPRECATED)
target_compile_options(rizoma-server PRIVATE -Wall -Wextra -Wpedantic)

include(CTest)
find_package(Python3 COMPONENTS Interpreter)
if(BUILD_TESTING AND Python3_Interpreter_FOUND)
  add_test(NAME rizoma.http-smoke COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/smoke.py $<TARGET_FILE:rizoma-server> ${CMAKE_SOURCE_DIR}/web)
  set_tests_properties(rizoma.http-smoke PROPERTIES TIMEOUT 90)
  add_test(NAME rizoma.sqlite-migrations COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/migrations.py $<TARGET_FILE:rizoma-server>)
  set_tests_properties(rizoma.sqlite-migrations PROPERTIES TIMEOUT 30)
endif()
