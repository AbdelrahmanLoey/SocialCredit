const jwt=require('jsonwebtoken')
const KEY=()=>process.env.LOYALTY_CIPHER_KEY
module.exports=function auth(req,res,next){
  const token=req.headers.authorization?.split(' ')[1]
  if(!token)return res.status(401).json({error:'No token'})
  try{req.user=jwt.verify(token,KEY());next()}
  catch{res.status(401).json({error:'Invalid token'})}
}
module.exports.adminOnly=function adminOnly(req,res,next){
  const token=req.headers.authorization?.split(' ')[1]
  if(!token)return res.status(401).json({error:'No token'})
  try{
    const decoded=jwt.verify(token,KEY())
    if(!decoded.isAdmin)return res.status(403).json({error:'Forbidden'})
    req.user=decoded;next()
  }catch{res.status(401).json({error:'Invalid token'})}
}
module.exports.sign=id=>jwt.sign({id},KEY(),{expiresIn:'7d'})
module.exports.signAdmin=(id,isAdmin)=>jwt.sign({id,isAdmin},KEY(),{expiresIn:'7d'})