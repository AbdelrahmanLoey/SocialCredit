const router=require('express').Router()
const auth=require('../middleware')
const{User,Notification}=require('../models')
const{upload,processImage,processImageFromUrl}=require('../utils/imgUpload')
router.get('/search',auth,async(req,res)=>{
  try{
    const q=(req.query.q||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
    const users=await User.find({username:{$regex:`^${q}`,$options:'i'}})
      .select('username avatar creditScore jailed jailUntil isAdmin').limit(10).lean()
    res.json(users)
  }catch(e){res.status(500).json({error:e.message})}
})
router.put('/me',auth,upload.single('avatar'),async(req,res)=>{
  try{
    const{bio,username,avatarUrl}=req.body
    const update={}
    if(bio!==undefined)update.bio=bio
    if(username)update.username=username
    if(req.file)update.avatar=await processImage(req.file.buffer)
    else if(avatarUrl&&avatarUrl.startsWith('http')){
      try{update.avatar=await processImageFromUrl(avatarUrl)}catch{return res.status(400).json({error:'Could not fetch avatar URL'})}
    }
    const user=await User.findByIdAndUpdate(req.user.id,update,{new:true,runValidators:true})
      .select('-password -resetToken -resetExpiry').lean()
    res.json(user)
  }catch(e){res.status(400).json({error:e.code===11000?'Username taken':e.message})}
})
router.get('/u/:username',auth,async(req,res)=>{
  try{
    const user=await User.findOne({username:req.params.username})
      .select('-password -resetToken -resetExpiry')
      .populate('comrades','username avatar creditScore jailed isAdmin').lean()
    if(!user)return res.status(404).json({error:'Not found'})
    res.json(user)
  }catch(e){res.status(500).json({error:e.message})}
})
router.get('/:id',auth,async(req,res)=>{
  try{
    const user=await User.findById(req.params.id)
      .select('-password -resetToken -resetExpiry')
      .populate('comrades','username avatar creditScore jailed isAdmin').lean()
    if(!user)return res.status(404).json({error:'Not found'})
    res.json(user)
  }catch(e){res.status(500).json({error:e.message})}
})
router.post('/:id/comrade',auth,async(req,res)=>{
  try{
    if(req.params.id===req.user.id)return res.status(400).json({error:'Cannot comrade yourself'})
    const me=await User.findById(req.user.id).select('comrades')
    const already=me.comrades.some(c=>c.toString()===req.params.id)
    already?me.comrades.pull(req.params.id):me.comrades.addToSet(req.params.id)
    const notifPromise=!already?Notification.create({recipient:req.params.id,sender:req.user.id,type:'comrade'}):Promise.resolve()
    await Promise.all([me.save(),notifPromise])
    if(!already){
      const pushNotifCount=req.app.get('pushNotifCount')
      if(pushNotifCount)pushNotifCount(req.params.id)
    }
    res.json({comrades:me.comrades.length,isComrade:!already})
  }catch(e){res.status(400).json({error:e.message})}
})
module.exports=router
