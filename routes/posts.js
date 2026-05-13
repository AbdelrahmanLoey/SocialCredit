const router=require('express').Router()
const auth=require('../middleware')
const{Post,User,Notification,Comment}=require('../models')
const{upload,processImage}=require('../utils/imgUpload')
router.get('/',auth,async(req,res)=>{
  try{
    const{area='public',group,author,before}=req.query
    if(area==='jail'){
      const me=await User.findById(req.user.id).select('creditScore isAdmin').lean()
      if(!me?.isAdmin&&(me?.creditScore??100)>50)return res.status(403).json({error:'Only citizens with 50 or less social credit may enter the gulag'})
    }
    const filter={area}
    if(group)filter.group=group
    if(author)filter.author=author
    if(before)filter.createdAt={$lt:new Date(before)}
    const posts=await Post.find(filter)
      .populate('author','username avatar creditScore jailed isAdmin')
      .populate('group','name')
      .sort({createdAt:-1}).limit(20).lean()
    if(posts.length){
      const counts=await Comment.aggregate([{$match:{post:{$in:posts.map(p=>p._id)}}},{$group:{_id:'$post',n:{$sum:1}}}])
      const cm=new Map(counts.map(c=>[c._id.toString(),c.n]))
      posts.forEach(p=>{p.commentCount=cm.get(p._id.toString())??0})
    }
    res.json(posts)
  }catch(e){res.status(500).json({error:e.message})}
})
router.post('/',auth,upload.single('image'),async(req,res)=>{
  try{
    const{content,area='public',group}=req.body
    const me=await User.findById(req.user.id).select('creditScore jailUntil jailed isAdmin').lean()
    if(!me?.isAdmin){
      if(me?.jailUntil&&new Date(me.jailUntil)>new Date())return res.status(403).json({error:`You are jailed until ${new Date(me.jailUntil).toLocaleString()}`})
    }
    if(area==='jail'&&!me?.isAdmin&&(me?.creditScore??100)>50)return res.status(403).json({error:'Only jailed citizens may post in the gulag'})
    if(!content?.trim()&&!req.file)return res.status(400).json({error:'Post cannot be empty'})
    let imageUrl=''
    if(req.file)imageUrl=await processImage(req.file.buffer)
    const post=await Post.create({author:req.user.id,content:content||'',area,group:group||null,image:imageUrl})
    await post.populate('author','username avatar creditScore jailed isAdmin')
    const obj=post.toObject();obj.commentCount=0
    res.json(obj)
  }catch(e){res.status(400).json({error:e.message})}
})
router.post('/:id/vote',auth,async(req,res)=>{
  try{
    const{type}=req.body
    const uid=req.user.id
    const post=await Post.findById(req.params.id)
    if(!post)return res.status(404).json({error:'Not found'})
    if(post.author.toString()===uid)return res.status(400).json({error:'Cannot vote on your own post'})
    const add=type==='up'?'upvotes':'downvotes'
    const remove=type==='up'?'downvotes':'upvotes'
    const already=post[add].some(id=>id.toString()===uid)
    if(already){
      post[add].pull(uid)
      const delta=type==='up'?-1:1
      const author=await User.findByIdAndUpdate(post.author,{$inc:{creditScore:delta}},{new:true,select:'creditScore jailed'})
      if(author){const j=author.creditScore<=50;if(author.jailed!==j)await User.updateOne({_id:author._id},{jailed:j})}
      await post.save()
    }else{
      const switched=post[remove].some(id=>id.toString()===uid)
      post[add].addToSet(uid);post[remove].pull(uid)
      const delta=switched?(type==='up'?2:-2):(type==='up'?1:-1)
      const[author]=await Promise.all([
        User.findByIdAndUpdate(post.author,{$inc:{creditScore:delta}},{new:true,select:'creditScore jailed'}),
        post.save(),
        Notification.create({recipient:post.author,sender:uid,type:type==='up'?'upvote':'downvote',post:post._id}),
      ])
      if(author){const j=author.creditScore<=50;if(author.jailed!==j)await User.updateOne({_id:author._id},{jailed:j})}
      const pushNotifCount=req.app.get('pushNotifCount')
      if(pushNotifCount)pushNotifCount(post.author)
    }
    res.json({upvotes:post.upvotes.length,downvotes:post.downvotes.length})
  }catch(e){res.status(400).json({error:e.message})}
})
router.post('/:id/report',auth,async(req,res)=>{
  try{
    const{reason='suspicious activity'}=req.body
    const post=await Post.findById(req.params.id)
    if(!post)return res.status(404).json({error:'Not found'})
    if(post.reports.some(r=>r.user.toString()===req.user.id))return res.status(400).json({error:'Already reported'})
    post.reports.push({user:req.user.id,reason})
    await Promise.all([post.save(),post.author.toString()!==req.user.id&&Notification.create({recipient:post.author,sender:req.user.id,type:'report',post:post._id})])
    const pushNotifCount=req.app.get('pushNotifCount')
    if(pushNotifCount)pushNotifCount(post.author)
    res.json({message:'Reported to CCCP. The Party sees everything.'})
  }catch(e){res.status(400).json({error:e.message})}
})
router.delete('/:id',auth,async(req,res)=>{
  try{
    const post=await Post.findById(req.params.id).select('author')
    if(!post)return res.status(404).json({error:'Not found'})
    const me=await User.findById(req.user.id).select('isAdmin').lean()
    if(post.author.toString()!==req.user.id&&!me?.isAdmin)return res.status(403).json({error:'Not your post'})
    await Promise.all([post.deleteOne(),Comment.deleteMany({post:req.params.id})])
    res.json({deleted:true})
  }catch(e){res.status(400).json({error:e.message})}
})
router.get('/:id/comments',auth,async(req,res)=>{
  try{
    const comments=await Comment.find({post:req.params.id})
      .populate('author','username avatar creditScore jailed isAdmin')
      .sort({createdAt:1}).lean()
    res.json(comments)
  }catch(e){res.status(500).json({error:e.message})}
})
router.post('/:id/comments',auth,async(req,res)=>{
  try{
    const{content}=req.body
    if(!content?.trim())return res.status(400).json({error:'Empty comment'})
    const me=await User.findById(req.user.id).select('jailUntil isAdmin').lean()
    if(!me?.isAdmin&&me?.jailUntil&&new Date(me.jailUntil)>new Date())return res.status(403).json({error:'You are currently jailed'})
    const[comment]=await Promise.all([
      Comment.create({post:req.params.id,author:req.user.id,content}),
      Post.updateOne({_id:req.params.id},{$inc:{commentCount:1}}),
    ])
    await comment.populate('author','username avatar creditScore jailed isAdmin')
    res.json(comment)
  }catch(e){res.status(400).json({error:e.message})}
})
router.delete('/:id/comments/:cid',auth,async(req,res)=>{
  try{
    const c=await Comment.findById(req.params.cid).select('author')
    if(!c)return res.status(404).json({error:'Not found'})
    const me=await User.findById(req.user.id).select('isAdmin').lean()
    if(c.author.toString()!==req.user.id&&!me?.isAdmin)return res.status(403).json({error:'Not yours'})
    await Promise.all([c.deleteOne(),Post.updateOne({_id:req.params.id},{$inc:{commentCount:-1}})])
    res.json({deleted:true})
  }catch(e){res.status(400).json({error:e.message})}
})
module.exports=router
