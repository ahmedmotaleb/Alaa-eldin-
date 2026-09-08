const sharp = require('sharp')

const SIZE = 2732
const LOGO_SIZE = 1100

async function main() {
  const logo = await sharp('public/images/logo.png').resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain' }).toBuffer()
  await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: '#ffffff' } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile('assets/splash.png')
  console.log('done')
}

main().catch(err => { console.error(err); process.exit(1) })
