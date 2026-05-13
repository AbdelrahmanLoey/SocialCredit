const router=require('express').Router()
const {adminOnly}=require('../middleware')
const {User,Post,Group,Notification,Comment}=require('../models')
/* ── All reports ── */
router.get('/reports/posts',adminOnly,async(req,res)=>{
  try{
    const posts=await Post.find({'reports.0':{$exists:true}}).populate('author','username avatar creditScore').populate('reports.user','username').sort({createdAt:-1}).lean()
    res.json(posts)
  }catch(e){res.status(500).json({error:e.message})}
})
router.get('/reports/groups',adminOnly,async(req,res)=>{
  try{
    const groups=await Group.find({'reports.0':{$exists:true}}).populate('creator','username').populate('reports.user','username').sort({createdAt:-1}).lean()
    res.json(groups)
  }catch(e){res.status(500).json({error:e.message})}
})
/* ── Users list ── */
router.get('/users',adminOnly,async(req,res)=>{
  try{
    const users=await User.find().select('-password -resetToken -resetExpiry').sort({createdAt:-1}).limit(100).lean()
    res.json(users)
  }catch(e){res.status(500).json({error:e.message})}
})
/* ── Jail user ── */
router.post('/jail/:id',adminOnly,async(req,res)=>{
  try{
    const{hours=24,reason='Party directive'}=req.body
    const jailUntil=new Date(Date.now()+hours*3600000)
    const user=await User.findByIdAndUpdate(req.params.id,{jailUntil,jailed:true},{new:true,select:'username jailUntil'})
    if(!user)return res.status(404).json({error:'User not found'})
    await Notification.create({recipient:req.params.id,type:'admin_jail',message:`You have been jailed for ${hours} hour(s): ${reason}. You cannot post or comment until ${jailUntil.toLocaleString()}.`})
    const sendTo=req.app.get('sendTo')
    if(sendTo)sendTo(req.params.id,{type:'public_warning',message:`☭ You have been jailed for ${hours} hour(s). Reason: ${reason}`,isJail:true,jailUntil:jailUntil.toISOString()})
    res.json({jailed:true,jailUntil,username:user.username})
  }catch(e){res.status(400).json({error:e.message})}
})
/* ── Unjail user ── */
router.post('/unjail/:id',adminOnly,async(req,res)=>{
  try{
    const user=await User.findByIdAndUpdate(req.params.id,{jailUntil:null,jailed:false},{new:true,select:'username creditScore'})
    if(!user)return res.status(404).json({error:'User not found'})
    const shouldJail=user.creditScore<=50
    if(shouldJail)await User.updateOne({_id:req.params.id},{jailed:true})
    await Notification.create({recipient:req.params.id,type:'system',message:'Your administrative jail sentence has been lifted by the Party.'})
    res.json({unjailed:true,username:user.username})
  }catch(e){res.status(400).json({error:e.message})}
})
/* ── Adjust credit ── */
router.post('/credit/:id',adminOnly,async(req,res)=>{
  try{
    const{amount}=req.body
    const user=await User.findByIdAndUpdate(req.params.id,{$inc:{creditScore:Number(amount)}},{new:true,select:'username creditScore'})
    if(!user)return res.status(404).json({error:'Not found'})
    const shouldJail=user.creditScore<=50
    await User.updateOne({_id:req.params.id},{jailed:shouldJail})
    res.json(user)
  }catch(e){res.status(400).json({error:e.message})}
})
/* ── Send warning notification ── */
router.post('/warn/:id',adminOnly,async(req,res)=>{
  try{
    const{message}=req.body
    if(!message)return res.status(400).json({error:'Message required'})
    await Notification.create({recipient:req.params.id,type:'admin_warning',message})
    const sendTo=req.app.get('sendTo')
    if(sendTo)sendTo(req.params.id,{type:'public_warning',message:`☭ Warning from the Party: ${message}`,isWarning:true})
    res.json({sent:true})
  }catch(e){res.status(400).json({error:e.message})}
})
/* ── Public broadcast to all ── */
router.post('/broadcast',adminOnly,async(req,res)=>{
  try{
    const{message}=req.body
    if(!message)return res.status(400).json({error:'Message required'})
    const broadcastAll=req.app.get('broadcastAll')
    if(broadcastAll)broadcastAll({type:'public_warning',message:`☭ PARTY ANNOUNCEMENT: ${message}`,isGlobal:true,ts:Date.now()})
    res.json({sent:true})
  }catch(e){res.status(400).json({error:e.message})}
})
/* ── Delete post (admin) ── */
router.delete('/post/:id',adminOnly,async(req,res)=>{
  try{
    const post=await Post.findById(req.params.id)
    if(!post)return res.status(404).json({error:'Not found'})
    await Promise.all([post.deleteOne(),Comment.deleteMany({post:req.params.id})])
    res.json({deleted:true})
  }catch(e){res.status(400).json({error:e.message})}
})
/* ── Clear reports on post ── */
router.post('/clear-reports/:id',adminOnly,async(req,res)=>{
  try{
    await Post.updateOne({_id:req.params.id},{$set:{reports:[]}})
    res.json({ok:true})
  }catch(e){res.status(400).json({error:e.message})}
})
/* ── Stats ── */
router.get('/stats',adminOnly,async(req,res)=>{
  try{
    const[users,posts,jailed,reported]=await Promise.all([
      User.countDocuments(),
      Post.countDocuments(),
      User.countDocuments({$or:[{jailed:true},{jailUntil:{$gt:new Date()}}]}),
      Post.countDocuments({'reports.0':{$exists:true}}),
    ])
    res.json({users,posts,jailed,reported})
  }catch(e){res.status(500).json({error:e.message})}
})
module.exports=router