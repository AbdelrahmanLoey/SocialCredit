const multer  = require('multer')
const sharp   = require('sharp')
const https   = require('https')
const http    = require('http')

// ── Cloudinary via raw HTTPS — no extra package needed ───────────────────────
async function cloudinaryUpload(buffer, isGif) {
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env
  const timestamp = Math.floor(Date.now() / 1000)
  const folder    = 'social-credit'
  const crypto    = require('crypto')
  const sigStr    = `folder=${folder}&timestamp=${timestamp}${secret}`
  const signature = crypto.createHash('sha1').update(sigStr).digest('hex')

  const boundary = '----FormBoundary' + crypto.randomBytes(8).toString('hex')
  const ext      = isGif ? 'gif' : 'webp'

  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.${ext}"\r\nContent-Type: image/${ext}\r\n\r\n`,
    buffer,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="api_key"\r\n\r\n${key}`,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="timestamp"\r\n\r\n${timestamp}`,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\n${folder}`,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="signature"\r\n\r\n${signature}`,
    `\r\n--${boundary}--\r\n`,
  ]
  const body = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)))

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.cloudinary.com',
      path    : `/v1_1/${cloud}/image/upload`,
      method  : 'POST',
      headers : { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.secure_url) resolve(json.secure_url)
          else reject(new Error(json.error?.message || 'Upload failed'))
        } catch(e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── Multer ────────────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|gif|webp|avif)$/.test(file.mimetype)
    cb(ok ? null : new Error('Only image files allowed'), ok)
  },
})

function isGif(buffer) {
  return buffer.length >= 6 &&
    buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46
}

async function processImage(buffer) {
  const gif = isGif(buffer)
  let out = buffer
  if (!gif) {
    out = await sharp(buffer)
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 5, smartSubsample: true })
      .toBuffer()
  } else {
    try {
      out = await sharp(buffer, { animated: true })
        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
        .gif().toBuffer()
    } catch { out = buffer }
  }
  return cloudinaryUpload(out, gif)
}

async function processImageFromUrl(url) {
  const lib    = url.startsWith('https') ? https : http
  const buffer = await new Promise((res, rej) => {
    lib.get(url, { timeout: 10000 }, r => {
      if (r.statusCode !== 200) return rej(new Error(`HTTP ${r.statusCode}`))
      const chunks = []
      r.on('data', c => chunks.push(c))
      r.on('end',  () => res(Buffer.concat(chunks)))
      r.on('error', rej)
    }).on('error', rej)
  })
  return processImage(buffer)
}

module.exports = { upload, processImage, processImageFromUrl }
