const router=require('express').Router()
const auth=require('../middleware')
const mongoose=require('mongoose')
const {Message,Notification}=require('../models')
router.get('/',auth,async(req,res)=>{
  try{
    const uid=new mongoose.Types.ObjectId(req.user.id)
    const convos=await Message.aggregate([
      {$match:{$or:[{from:uid},{to:uid}]}},
      {$sort:{createdAt:-1}},
      {$group:{_id:{$cond:{if:{$gt:['$from','$to']},then:{a:'$from',b:'$to'},else:{a:'$to',b:'$from'}}},lastMsg:{$first:'$$ROOT'},unread:{$sum:{$cond:[{$and:[{$eq:['$to',uid]},{$eq:['$read',false]}]},1,0]}}}},
      {$sort:{'lastMsg.createdAt':-1}},
      {$limit:30},
      {$lookup:{from:'users',let:{fromId:'$lastMsg.from',toId:'$lastMsg.to'},pipeline:[{$match:{$expr:{$or:[{$eq:['$_id','$$fromId']},{$eq:['$_id','$$toId']}]}}},{$project:{username:1,avatar:1,isAdmin:1}}],as:'users'}},
      {$project:{'lastMsg.attachments':0}},
    ])
    const result=convos.map(c=>{
      const partnerId=c.lastMsg.from.toString()===req.user.id?c.lastMsg.to:c.lastMsg.from
      const partner=c.users.find(u=>u._id.toString()===partnerId.toString())
      return{partner,lastMsg:c.lastMsg,unread:c.unread}
    })
    res.json(result)
  }catch(e){res.status(500).json({error:e.message})}
})
router.get('/:userId',auth,async(req,res)=>{
  try{
    const uid=req.user.id
    const[msgs]=await Promise.all([
      Message.find({$or:[{from:uid,to:req.params.userId},{from:req.params.userId,to:uid}]}).populate('from','username avatar isAdmin').sort({createdAt:1}).limit(200).lean(),
      Message.updateMany({from:req.params.userId,to:uid,read:false},{read:true}),
    ])
    res.json(msgs)
  }catch(e){res.status(500).json({error:e.message})}
})
router.post('/:userId',auth,async(req,res)=>{
  try{
    const{content='',attachments=[]}=req.body
    if(!content?.trim()&&!attachments.length)return res.status(400).json({error:'Empty'})
    const clean=attachments.slice(0,3).map(a=>({name:String(a.name||'').slice(0,120),type:String(a.type||'').slice(0,80),url:String(a.url||''),size:Number(a.size||0)}))
    const msg=await Message.create({from:req.user.id,to:req.params.userId,content,attachments:clean})
    await msg.populate('from','username avatar isAdmin')
    res.json(msg)
  }catch(e){res.status(400).json({error:e.message})}
})
router.post('/:userId/report',auth,async(req,res)=>{
  try{
    const{messageId}=req.body
    const uid=req.user.id
    const msg=await Message.findById(messageId).select('from to').lean()
    if(!msg)return res.status(404).json({error:'Message not found'})
    const inConvo=(msg.from.toString()===uid&&msg.to.toString()===req.params.userId)||(msg.to.toString()===uid&&msg.from.toString()===req.params.userId)
    if(!inConvo)return res.status(403).json({error:'Cannot report this message'})
    const other=msg.from.toString()===uid?msg.to:msg.from
    await Notification.create({recipient:other,sender:uid,type:'messageReport'})
    res.json({ok:true})
  }catch(e){res.status(400).json({error:e.message})}
})
module.exports=router