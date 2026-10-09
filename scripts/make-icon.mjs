import { _electron } from 'playwright'
import electron from 'electron'
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const temporary = await mkdtemp(join(tmpdir(), 'scout-icon-'))
const iconset = join(temporary, 'icon.iconset')
await mkdir(iconset)
const profile = join(temporary, 'profile')
await mkdir(profile)
const application = await _electron.launch({ executablePath: electron, args: ['.', `--user-data-dir=${profile}`], cwd: process.cwd() })
try {
  const page = await application.firstWindow()
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 1024))
  await page.setContent(`<html><body style="margin:0;background:transparent">${await readFile('build/icon.svg', 'utf8')}</body></html>`)
  const source = resolve('build/icon.png')
  await page.locator('svg').screenshot({ path: source, omitBackground: true })
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale)
      execFileSync('sips', ['-z', pixels, pixels, source, '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' })
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', resolve('build/icon.icns')])
  console.log('Created build/icon.icns from the editable SVG source.')
} finally {
  await application.close()
  await rm(temporary, { recursive: true, force: true })
}
