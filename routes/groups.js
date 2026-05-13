const router=require('express').Router()
const auth=require('../middleware')
const {Group,User,Notification}=require('../models')
router.get('/',auth,async(req,res)=>{
  try{
    const groups=await Group.find().populate('creator','username avatar').sort({createdAt:-1}).limit(50).lean()
    res.json(groups)
  }catch(e){res.status(500).json({error:e.message})}
})
router.post('/',auth,async(req,res)=>{
  try{
    const{name,description,type='public'}=req.body
    const me=await User.findById(req.user.id).select('creditScore isAdmin').lean()
    if(!me?.isAdmin){
      if(type==='smugglers'&&(me?.creditScore??0)<200)return res.status(403).json({error:'Need 200+ Social Credit to create an underground cell'})
      if((me?.creditScore??0)<100)return res.status(403).json({error:'Need 100+ Social Credit to create a collective'})
    }
    const group=await Group.create({name,description,type,creator:req.user.id,members:[req.user.id]})
    await group.populate('creator','username avatar')
    res.json(group)
  }catch(e){res.status(400).json({error:e.code===11000?'Name already taken':e.message})}
})
router.get('/:id',auth,async(req,res)=>{
  try{
    const group=await Group.findById(req.params.id).populate('creator','username avatar').populate('members','username avatar creditScore').lean()
    if(!group)return res.status(404).json({error:'Not found'})
    res.json(group)
  }catch(e){res.status(500).json({error:e.message})}
})
router.put('/:id',auth,async(req,res)=>{
  try{
    const group=await Group.findById(req.params.id).select('creator name description')
    if(!group)return res.status(404).json({error:'Not found'})
    const me=await User.findById(req.user.id).select('isAdmin').lean()
    if(group.creator.toString()!==req.user.id&&!me?.isAdmin)return res.status(403).json({error:'Only the creator can edit this collective'})
    const{name,description}=req.body
    if(name)group.name=name
    if(description!==undefined)group.description=description
    await group.save()
    await group.populate('creator','username avatar')
    res.json(group)
  }catch(e){res.status(400).json({error:e.code===11000?'Name already taken':e.message})}
})
router.delete('/:id',auth,async(req,res)=>{
  try{
    const group=await Group.findById(req.params.id).select('creator')
    if(!group)return res.status(404).json({error:'Not found'})
    const me=await User.findById(req.user.id).select('isAdmin').lean()
    if(group.creator.toString()!==req.user.id&&!me?.isAdmin)return res.status(403).json({error:'Only the creator can delete this collective'})
    await group.deleteOne()
    res.json({deleted:true})
  }catch(e){res.status(400).json({error:e.message})}
})
router.post('/:id/join',auth,async(req,res)=>{
  try{
    const group=await Group.findById(req.params.id).select('members')
    if(!group)return res.status(404).json({error:'Not found'})
    const isMember=group.members.some(m=>m.toString()===req.user.id)
    isMember?group.members.pull(req.user.id):group.members.addToSet(req.user.id)
    await group.save()
    res.json({members:group.members.length,isMember:!isMember})
  }catch(e){res.status(400).json({error:e.message})}
})
router.post('/:id/report',auth,async(req,res)=>{
  try{
    const{reason='violations detected'}=req.body
    const group=await Group.findById(req.params.id)
    if(!group)return res.status(404).json({error:'Not found'})
    if(group.reports.some(r=>r.user.toString()===req.user.id))return res.status(400).json({error:'Already reported'})
    group.reports.push({user:req.user.id,reason})
    await group.save()
    res.json({message:'Collective reported to the Party.'})
  }catch(e){res.status(400).json({error:e.message})}
})
module.exports=router