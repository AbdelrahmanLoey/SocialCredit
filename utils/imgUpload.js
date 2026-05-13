const multer=require('multer')
const sharp=require('sharp')
const https=require('https')
const http=require('http')
const crypto=require('crypto')

// Upload buffer to Cloudinary, format: 'gif'|'webp'
async function cloudinaryUpload(buffer,format){
  const{CLOUDINARY_CLOUD_NAME:cloud,CLOUDINARY_API_KEY:key,CLOUDINARY_API_SECRET:secret}=process.env
  const ts=Math.floor(Date.now()/1000),folder='social-credit'
  const sig=crypto.createHash('sha1').update(`folder=${folder}&timestamp=${ts}${secret}`).digest('hex')
  const boundary='----FB'+crypto.randomBytes(8).toString('hex')
  const mime=format==='gif'?'image/gif':'image/webp'
  const parts=[
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.${format}"\r\nContent-Type: ${mime}\r\n\r\n`,
    buffer,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="api_key"\r\n\r\n${key}`,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="timestamp"\r\n\r\n${ts}`,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\n${folder}`,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="signature"\r\n\r\n${sig}`,
    `\r\n--${boundary}--\r\n`,
  ]
  const body=Buffer.concat(parts.map(p=>Buffer.isBuffer(p)?p:Buffer.from(p)))
  return new Promise((resolve,reject)=>{
    const req=https.request({
      hostname:'api.cloudinary.com',
      path:`/v1_1/${cloud}/image/upload`,
      method:'POST',
      headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':body.length},
    },res=>{
      let data=''
      res.on('data',c=>data+=c)
      res.on('end',()=>{
        try{const j=JSON.parse(data);j.secure_url?resolve(j.secure_url):reject(new Error(j.error?.message||'Upload failed'))}
        catch(e){reject(e)}
      })
    })
    req.on('error',reject);req.write(body);req.end()
  })
}

const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:8*1024*1024},
  fileFilter:(_,file,cb)=>{
    const ok=/^image\/(jpeg|jpg|png|gif|webp|avif)$/.test(file.mimetype)
    cb(ok?null:new Error('Only image files allowed'),ok)
  },
})

function isGif(buf){return buf.length>=3&&buf[0]===0x47&&buf[1]===0x49&&buf[2]===0x46}

async function detectFormat(buffer){
  if(isGif(buffer)){
    try{const m=await sharp(buffer,{animated:true}).metadata();return{format:'gif',animated:(m.pages||1)>1}}
    catch{return{format:'gif',animated:true}}
  }
  try{const m=await sharp(buffer,{animated:true}).metadata();return{format:'webp',animated:(m.pages||1)>1}}
  catch{return{format:'webp',animated:false}}
}

// Post/chat images: max 800x800
async function processImage(buffer){
  const{format,animated}=await detectFormat(buffer)
  if(format==='gif'){
    if(animated){
      try{const o=await sharp(buffer,{animated:true}).resize({width:800,height:800,fit:'inside',withoutEnlargement:true}).gif().toBuffer();return cloudinaryUpload(o,'gif')}
      catch{return cloudinaryUpload(buffer,'gif')}
    }
    const o=await sharp(buffer).resize({width:800,height:800,fit:'inside',withoutEnlargement:true}).webp({quality:82,effort:5,smartSubsample:true}).toBuffer()
    return cloudinaryUpload(o,'webp')
  }
  if(animated){
    try{const o=await sharp(buffer,{animated:true}).resize({width:800,height:800,fit:'inside',withoutEnlargement:true}).webp({quality:82,effort:5,smartSubsample:true}).toBuffer();return cloudinaryUpload(o,'webp')}
    catch{return cloudinaryUpload(buffer,'webp')}
  }
  const o=await sharp(buffer).resize({width:800,height:800,fit:'inside',withoutEnlargement:true}).webp({quality:82,effort:5,smartSubsample:true}).toBuffer()
  return cloudinaryUpload(o,'webp')
}

// Avatar: hard 128x128 cover crop, aggressive compression
async function processAvatar(buffer){
  const{animated}=await detectFormat(buffer)
  if(animated){
    try{
      const o=await sharp(buffer,{animated:true}).resize({width:128,height:128,fit:'cover',position:'centre'}).webp({quality:65,effort:6,smartSubsample:true}).toBuffer()
      return cloudinaryUpload(o,'webp')
    }catch{}
  }
  const o=await sharp(buffer).resize({width:128,height:128,fit:'cover',position:'centre'}).webp({quality:65,effort:6,smartSubsample:true}).toBuffer()
  return cloudinaryUpload(o,'webp')
}

async function fetchBuffer(url){
  const lib=url.startsWith('https')?https:http
  return new Promise((res,rej)=>{
    lib.get(url,{timeout:10000},r=>{
      if(r.statusCode!==200)return rej(new Error(`HTTP ${r.statusCode}`))
      const chunks=[]
      r.on('data',c=>chunks.push(c))
      r.on('end',()=>res(Buffer.concat(chunks)))
      r.on('error',rej)
    }).on('error',rej)
  })
}

async function processImageFromUrl(url){return processImage(await fetchBuffer(url))}
async function processAvatarFromUrl(url){return processAvatar(await fetchBuffer(url))}

module.exports={upload,processImage,processAvatar,processImageFromUrl,processAvatarFromUrl}
