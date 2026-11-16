"""Export the successful Playwright recording as a chaptered MP4 (requires ffmpeg)."""
import json
from pathlib import Path
import subprocess
import sys

output = Path(sys.argv[1]).resolve()
recordings = list((output / 'recording').glob('**/video.webm'))
if len(recordings) != 1:
    raise SystemExit('Expected exactly one completed recording under recording/.')
source = recordings[0]
report = json.loads((output / 'chapters.json').read_text())
probe = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(source)
]))
# Remove browser startup, keeping half a second before the first recorded chapter.
trim = max(0, float(probe['format']['duration']) - report['durationSeconds'] - 0.5)


def escape(text):
    for character in ['\\', ';', '#', '=']:
        text = text.replace(character, '\\' + character)
    return text.replace('\n', ' ')


metadata = [';FFMETADATA1', 'title=OHIF upload errors',
            'comment=Synthetic files and simulated server responses; recorded with Playwright.']
chapters = report['chapters']
for index, chapter in enumerate(chapters):
    start = chapter['seconds'] + 0.5
    end = (chapters[index + 1]['seconds'] if index + 1 < len(chapters) else report['durationSeconds']) + 0.5
    metadata += ['[CHAPTER]', 'TIMEBASE=1/1000', f'START={int(start * 1000)}',
                 f'END={int(end * 1000)}', f'title={escape(chapter["title"])}']
metadata_path = output / 'video-chapters.ffmetadata'
metadata_path.write_text('\n'.join(metadata) + '\n')
destination = output / 'ohif-upload-errors-demo.mp4'
subprocess.run([
    'ffmpeg', '-hide_banner', '-loglevel', 'warning', '-y', '-ss', str(trim),
    '-i', str(source), '-i', str(metadata_path), '-map', '0:v:0', '-map_metadata', '1',
    '-map_chapters', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', str(destination),
], check=True)
print(destination)
