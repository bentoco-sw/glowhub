"""Prepare clean production deploy bundle for GitHub Pages and Google Apps Script."""

from __future__ import annotations

import json
from pathlib import Path
import re
import shutil
import zipfile

ROOT_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT_DIR / 'dist'
STAGING_DIR = DIST_DIR / 'gh-pages'
ZIP_PATH = DIST_DIR / 'glowhub-bentoclub-deploy.zip'

DEPLOY_FILES = [
    '.nojekyll',
    '.gitignore',
    '.gitattributes',
    'index.html',
    'styles.css',
    'manifest.webmanifest',
    'sw.js',
    'README.md',
    'data/seed-data.js',
    'data/seed-data.json',
    'data/migrated-sales.js',
    'backend/Code.gs',
    '.github/CODEOWNERS',
    '.github/dependabot.yml',
    '.github/workflows/ci.yml',
    '.github/workflows/deploy-pages.yml',
]

DEPLOY_DIRS = [
    'assets',
    'js',
]


def parse_sw_static_assets(sw_path: Path) -> list[str]:
    """Extract relative asset paths declared in sw.js STATIC_ASSETS."""
    content = sw_path.read_text(encoding='utf-8')
    match = re.search(r'const\s+STATIC_ASSETS\s*=\s*\[(.*?)\];', content, flags=re.DOTALL)
    if not match:
        raise ValueError('Could not locate STATIC_ASSETS array in sw.js')
    return re.findall(r'"([^"]+)"', match.group(1))


def validate_sw_assets(root_dir: Path) -> list[str]:
    """Verify every asset declared in sw.js STATIC_ASSETS exists on disk."""
    assets = parse_sw_static_assets(root_dir / 'sw.js')
    missing: list[str] = []
    for raw_entry in assets:
        if raw_entry == './':
            target = root_dir / 'index.html'
        else:
            rel = raw_entry.lstrip('./')
            target = root_dir / rel
        if not target.is_file():
            missing.append(raw_entry)
    if missing:
        raise FileNotFoundError(f'Missing static assets referenced in sw.js: {missing}')
    return assets


def copy_clean_file(src: Path, dst: Path) -> None:
    """Copy a single file creating parent directories as needed."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def stage_deploy_tree(root_dir: Path, staging_dir: Path) -> list[Path]:
    """Build a clean GitHub Pages directory tree without local junk files."""
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir(parents=True, exist_ok=True)

    staged_files: list[Path] = []

    for rel_file in DEPLOY_FILES:
        src = root_dir / rel_file
        if not src.is_file():
            raise FileNotFoundError(f'Missing required deploy file: {rel_file}')
        dst = staging_dir / rel_file
        copy_clean_file(src, dst)
        staged_files.append(dst)

    for rel_dir in DEPLOY_DIRS:
        src_dir = root_dir / rel_dir
        if not src_dir.is_dir():
            raise FileNotFoundError(f'Missing required deploy directory: {rel_dir}')
        for src_item in sorted(src_dir.rglob('*')):
            if not src_item.is_file():
                continue
            if src_item.name == '.DS_Store' or '__pycache__' in src_item.parts:
                continue
            rel = src_item.relative_to(root_dir)
            dst = staging_dir / rel
            copy_clean_file(src_item, dst)
            staged_files.append(dst)

    return staged_files


def create_deploy_zip(staging_dir: Path, zip_path: Path) -> int:
    """Package staged deploy tree into a deterministic zip archive."""
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    if zip_path.exists():
        zip_path.unlink()

    files_written = 0
    with zipfile.ZipFile(zip_path, mode='w', compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(staging_dir.rglob('*')):
            if not file_path.is_file():
                continue
            arcname = str(file_path.relative_to(staging_dir)).replace('\\', '/')
            zf.write(file_path, arcname=arcname)
            files_written += 1
    return files_written


def main() -> int:
    """Validate static PWA assets, stage dist/gh-pages and produce deploy zip."""
    sw_assets = validate_sw_assets(ROOT_DIR)
    staged_files = stage_deploy_tree(ROOT_DIR, STAGING_DIR)
    zip_count = create_deploy_zip(STAGING_DIR, ZIP_PATH)

    summary = {
        'ok': True,
        'sw_assets_validated': len(sw_assets),
        'staged_files_count': len(staged_files),
        'zip_entries_count': zip_count,
        'staging_dir': str(STAGING_DIR),
        'zip_path': str(ZIP_PATH),
        'zip_size_bytes': ZIP_PATH.stat().st_size,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
