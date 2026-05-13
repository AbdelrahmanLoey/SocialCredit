const multer=require('multer')
const sharp=require('sharp')
const path=require('path')
const fs=require('fs')
const UPLOADS=path.join(__dirname,'../uploads')
if(!fs.existsSync(UPLOADS))fs.mkdirSync(UPLOADS,{recursive:true})
const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:8*1024*1024},
  fileFilter:(_,file,cb)=>{
    const ok=/^image\/(jpeg|jpg|png|gif|webp|avif)$/.test(file.mimetype)
    cb(ok?null:new Error('Only image files allowed'),ok)
  }
})
function isGif(buffer){
  return buffer.length>=6&&buffer[0]===0x47&&buffer[1]===0x49&&buffer[2]===0x46
}
async function processImage(buffer){
  const base=process.env.BACKEND_URL||`http://localhost:${process.env.PORT||5000}`
  if(isGif(buffer)){
    // Preserve GIF animation — sharp animated resize, fallback to raw save
    try{
      const name=`${Date.now()}-${Math.random().toString(36).slice(2)}.gif`
      const dest=path.join(UPLOADS,name)
      await sharp(buffer,{animated:true})
        .resize({width:800,height:800,fit:'inside',withoutEnlargement:true})
        .gif()
        .toFile(dest)
      return`${base}/uploads/${name}`
    }catch{
      const name=`${Date.now()}-${Math.random().toString(36).slice(2)}.gif`
      const dest=path.join(UPLOADS,name)
      fs.writeFileSync(dest,buffer)
      return`${base}/uploads/${name}`
    }
  }
  const name=`${Date.now()}-${Math.random().toString(36).slice(2)}.webp`
  const dest=path.join(UPLOADS,name)
  await sharp(buffer)
    .resize({width:800,height:800,fit:'inside',withoutEnlargement:true})
    .webp({quality:82,effort:5,smartSubsample:true,nearLossless:false})
    .toFile(dest)
  return`${base}/uploads/${name}`
}
async function processImageFromUrl(url){
  const https=require('https')
  const http=require('http')
  const lib=url.startsWith('https')?https:http
  const buffer=await new Promise((res,rej)=>{
    lib.get(url,{timeout:10000},(r)=>{
      if(r.statusCode!==200)return rej(new Error(`HTTP ${r.statusCode}`))
      const chunks=[]
      r.on('data',c=>chunks.push(c))
      r.on('end',()=>res(Buffer.concat(chunks)))
      r.on('error',rej)
    }).on('error',rej)
  })
  return processImage(buffer)
}
module.exports={upload,processImage,processImageFromUrl}