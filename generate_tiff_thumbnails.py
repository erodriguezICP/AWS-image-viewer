#!/usr/bin/env python3
import argparse, io, logging, os, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
import boto3
from botocore.exceptions import ClientError
from PIL import Image, ImageOps

DEFAULT_BUCKET='manifest-inventory'; DEFAULT_SOURCE_PREFIX='Key Manifest/'; DEFAULT_DESTINATION_PREFIX='Key Manifest Thumbnails/'
DEFAULT_MAX_DIMENSION=1200; DEFAULT_QUALITY=85; DEFAULT_WORKERS=3; DEFAULT_MAX_SOURCE_MB=200; DEFAULT_MAX_PIXELS=100_000_000
TIFF_EXTENSIONS=('.tif','.tiff')
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s'); logger=logging.getLogger(__name__)

def norm(p): return p if not p or p.endswith('/') else p+'/'
def dest_key(k,sp,dp):
    rel=k[len(sp):] if k.startswith(sp) else k
    return norm(dp)+os.path.splitext(rel)[0]+'.jpg'
def exists(s3,b,k):
    try: s3.head_object(Bucket=b,Key=k); return True
    except ClientError as e:
        if str(e.response.get('Error',{}).get('Code','')) in {'404','NoSuchKey','NotFound'}: return False
        raise

def iter_tiffs(s3,a):
    lim=int(a.max_source_mb*1024*1024)
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=a.bucket,Prefix=a.source_prefix):
        for item in page.get('Contents',[]):
            k=item.get('Key',''); size=int(item.get('Size',0))
            if not k.lower().endswith(TIFF_EXTENSIONS): continue
            if size>lim:
                logger.warning('Skipping oversized TIFF before download: %s (%.1f MB > %.1f MB limit)',k,size/(1024*1024),a.max_source_mb); continue
            yield k

def convert(s3,a,k):
    target=dest_key(k,a.source_prefix,a.destination_prefix)
    if not a.overwrite and exists(s3,a.bucket,target): return 'skipped',k,target
    if a.dry_run: return 'planned',k,target
    data=s3.get_object(Bucket=a.bucket,Key=k)['Body'].read()
    with Image.open(io.BytesIO(data)) as im:
        pixels=im.width*im.height
        if pixels>a.max_pixels:
            logger.warning('Skipping oversized image by pixel count: %s (%d pixels > %d pixel limit)',k,pixels,a.max_pixels)
            return 'skipped',k,target
        im=ImageOps.exif_transpose(im)
        if im.mode!='RGB': im=im.convert('RGB')
        im.thumbnail((a.max_dimension,a.max_dimension),Image.Resampling.LANCZOS)
        out=io.BytesIO(); im.save(out,format='JPEG',quality=a.quality,optimize=True)
    del data; out.seek(0)
    s3.put_object(Bucket=a.bucket,Key=target,Body=out.getvalue(),ContentType='image/jpeg',CacheControl='public, max-age=31536000'); out.close()
    return 'created',k,target

def args():
    p=argparse.ArgumentParser(description='Create browser-friendly JPEG thumbnails for TIFF files in S3.')
    p.add_argument('--bucket',default=DEFAULT_BUCKET); p.add_argument('--source-prefix',default=DEFAULT_SOURCE_PREFIX); p.add_argument('--destination-prefix',default=DEFAULT_DESTINATION_PREFIX)
    p.add_argument('--max-dimension',type=int,default=DEFAULT_MAX_DIMENSION); p.add_argument('--quality',type=int,default=DEFAULT_QUALITY); p.add_argument('--workers',type=int,default=DEFAULT_WORKERS)
    p.add_argument('--max-source-mb',type=float,default=DEFAULT_MAX_SOURCE_MB,help='Skip TIFFs larger than this size in MB before download (default: 200).')
    p.add_argument('--max-pixels',type=int,default=DEFAULT_MAX_PIXELS,help='Skip TIFFs exceeding this pixel count before full decompression (default: 100000000).')
    p.add_argument('--overwrite',action='store_true'); p.add_argument('--dry-run',action='store_true'); return p.parse_args()

def main():
    a=args(); a.source_prefix=norm(a.source_prefix); a.destination_prefix=norm(a.destination_prefix); a.workers=max(1,a.workers); a.max_dimension=max(1,a.max_dimension); a.quality=min(100,max(1,a.quality))
    if a.max_source_mb<=0 or a.max_pixels<=0: raise SystemExit('Size and pixel limits must be greater than zero')
    s3=boto3.client('s3'); logger.info('Workers: %d | max source: %.1f MB | max pixels: %d',a.workers,a.max_source_mb,a.max_pixels)
    sources=list(iter_tiffs(s3,a)); total=len(sources); logger.info('Eligible TIFF files: %d',total); c={'created':0,'skipped':0,'planned':0,'failed':0}
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        fs={ex.submit(convert,s3,a,k):k for k in sources}
        for n,f in enumerate(as_completed(fs),1):
            try: status,src,dst=f.result()
            except Exception:
                c['failed']+=1; logger.exception('[%d/%d] failed: %s',n,total,fs[f]); continue
            c[status]+=1; logger.info('[%d/%d] %s: %s -> %s',n,total,status,src,dst)
    logger.info('Complete. created=%d skipped=%d planned=%d failed=%d',c['created'],c['skipped'],c['planned'],c['failed']); return 1 if c['failed'] else 0
if __name__=='__main__': sys.exit(main())
