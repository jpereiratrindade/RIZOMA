#!/usr/bin/env python3
# RIZOMA — HTTP smoke/regression gate for local image acquisition and preview.
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

import hashlib
import base64
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zlib

# Ensure loopback calls bypass system proxies (e.g. Squid/corporate environments)
urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))


def png(w=32, h=20, color=(124, 158, 142)):
    signature = b'\x89PNG\r\n\x1a\n'
    def chunk(kind, value):
        body = kind + value
        return struct.pack('!I', len(value)) + body + struct.pack('!I', zlib.crc32(body) & 0xffffffff)
    scanlines = b''.join(b'\x00' + bytes(color)*w for _ in range(h))
    return signature+chunk(b'IHDR',struct.pack('!IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(scanlines))+chunk(b'IEND',b'')


def req(url, method='GET', data=None, headers=None):
    request = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            return response.status, response.read(), response.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def main():
    exe, web = sys.argv[1:3]
    with tempfile.TemporaryDirectory(prefix='rizoma-test-') as temp:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        proc = subprocess.Popen([exe,'--data-dir',temp,'--web-dir',web,'--port',str(port)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        base=f'http://127.0.0.1:{port}'
        try:
            for _ in range(80):
                try:
                    if req(base+'/api/v1/health')[0] == 200: break
                except OSError:
                    time.sleep(.08)
            else: raise AssertionError('Server did not start')
            status,body,_=req(base+'/')
            assert status==200 and b'RIZOMA' in body
            data=png()
            upload=base+'/api/v1/images?filename=campo.png&sample_id=P01-T2&capture_date=2026-10-14'
            headers={'Content-Type':'application/octet-stream','X-Rizoma-Client':'web-v0.2.0'}
            status,body,_=req(upload,'POST',data,headers)
            assert status==201,(status,body)
            obj=json.loads(body)['data']
            assert obj['width']==32 and obj['height']==20 and obj['sha256']==hashlib.sha256(data).hexdigest(),obj
            assert obj['scientific_status']=='NOT_ANALYZED'
            uid=obj['id']
            for kind,magic in [('original',b'\x89PNG'),('preview',b'\x89PNG'),('grayscale',b'\x89PNG')]:
                status,payload,_=req(base+'/api/v1/images/'+uid+'/'+kind)
                assert status==200 and payload.startswith(magic),(kind,status)
            # A real, minimal 8x6 JPEG fixture, independent from imaging Python packages.
            jpeg = base64.b64decode(
                '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAGAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDn6KKK7DkP/9k='
            )
            status,body,_=req(base+'/api/v1/images?filename=teste.jpg','POST',jpeg,headers)
            assert status==201,(status,body)
            item=json.loads(body)['data']
            assert item['format']=='jpeg' and item['width']==8 and item['height']==6
            # A real, minimal 8x6 RGB TIFF fixture, independent from imaging Python packages.
            tiff = base64.b64decode(
                'SUkqAAgAAAAKAAABBAABAAAACAAAAAEBBAABAAAABgAAAAIBAwADAAAAhgAAAAMBAwABAAAAAQAAAAYB'
                'AwABAAAAAgAAABEBBAABAAAAjAAAABUBAwABAAAAAwAAABYBBAABAAAABgAAABcBBAABAAAAkAAAABwB'
                'AwABAAAAAQAAAAAAAAAIAAgACABklshklshklshklshklshklshklshklshklshklshklshklshklshkl'
                'shklshklshklshklshklshklshklshklshklshklshklshklshklshklshklshklshklshklshklshkls'
                'hklshklshklshklshklshklshklshklshklshklshklshklshklshklshklsg='
            )
            status,body,_=req(base+'/api/v1/images?filename=scanner_raiz.tif&sample_id=P01-RAIZ','POST',tiff,headers)
            assert status==201,(status,body)
            item_tif=json.loads(body)['data']
            assert item_tif['format']=='tiff' and item_tif['width']==8 and item_tif['height']==6
            status,payload,resp_hdrs=req(base+'/api/v1/images/'+item_tif['id']+'/original')
            assert status==200 and payload.startswith(b'II*\x00'),status
            assert resp_hdrs.get('Content-Type')=='image/tiff'
            status,payload,_=req(base+'/api/v1/images/'+item_tif['id']+'/preview')
            assert status==200 and payload.startswith(b'\x89PNG'),status
            status,body,_=req(base+'/api/v1/images')
            assert status==200 and len(json.loads(body)['data'])==3
            status,body,_=req(base+'/api/v1/export/manifest.csv')
            assert status==200 and b'P01-T2' in body and b'P01-RAIZ' in body and b'NOT_ANALYZED' in body
            status,body,_=req(upload,'POST',data,headers)
            assert status==409,(status,body)
            status,body,_=req(upload,'POST',b'<script>not an image</script>',headers)
            assert status==415,(status,body)
            status,body,_=req(upload,'POST',data,{'Content-Type':'application/octet-stream'})
            assert status==403,(status,body)
            status,body,_=req(base+'/api/v1/images/../../etc/passwd')
            assert status in (400,404),(status,body)
            # Persistence after an actual restart
            proc.terminate(); proc.wait(timeout=6)
            proc=subprocess.Popen([exe,'--data-dir',temp,'--web-dir',web,'--port',str(port)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            for _ in range(80):
                try:
                    status,body,_=req(base+'/api/v1/images')
                    if status==200: break
                except OSError: time.sleep(.08)
            else: raise AssertionError('Restart failed')
            assert len(json.loads(body)['data'])==3
            assert (Path(temp)/'rizoma.sqlite3').exists()
            print('RIZOMA smoke PASS: PNG/JPEG/TIFF, checksum, preservation, derivatives, CSV, duplicate, invalid, header, restart')

        finally:
            if proc.poll() is None:
                proc.terminate()
                try: proc.wait(timeout=5)
                except subprocess.TimeoutExpired: proc.kill()

if __name__=='__main__': main()
