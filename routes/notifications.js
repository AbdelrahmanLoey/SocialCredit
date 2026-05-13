const router=require('express').Router()
const auth=require('../middleware')
const {Notification}=require('../models')
router.get('/count',auth,async(req,res)=>{
  try{
    const count=await Notification.countDocuments({recipient:req.user.id,read:false})
    res.json({count})
  }catch(e){res.status(500).json({error:e.message})}
})
router.get('/',auth,async(req,res)=>{
  try{
    const raw=await Notification.find({recipient:req.user.id}).populate('sender','username avatar').populate('post','content').sort({createdAt:-1}).limit(100).lean()
    /* ── Group similar notifications ── */
    const groups=new Map()
    for(const n of raw){
      if(n.type==='upvote'||n.type==='downvote'){
        const key=`${n.type}:${n.post?._id||'none'}`
        if(!groups.has(key)){groups.set(key,{...n,senders:[n.sender],count:1})}
        else{const g=groups.get(key);if(g.count<50){g.senders.push(n.sender);g.count++;if(!n.read)g.read=false}}
      }else if(n.type==='comrade'){
        const key=`comrade:batch`
        if(!groups.has(key)){groups.set(key,{...n,senders:[n.sender],count:1})}
        else{const g=groups.get(key);g.senders.push(n.sender);g.count++;if(!n.read)g.read=false}
      }else{
        groups.set(n._id.toString(),{...n,senders:[n.sender],count:1})
      }
    }
    res.json([...groups.values()])
  }catch(e){res.status(500).json({error:e.message})}
})
router.put('/read',auth,async(req,res)=>{
  try{
    await Notification.updateMany({recipient:req.user.id,read:false},{read:true})
    res.json({ok:true})
  }catch(e){res.status(500).json({error:e.message})}
})
module.exports=router