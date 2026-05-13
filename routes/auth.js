const router=require('express').Router()
const jwt=require('jsonwebtoken')
const crypto=require('crypto')
const nodemailer=require('nodemailer')
const auth=require('../middleware')
const {sign,signAdmin}=require('../middleware')
const {User}=require('../models')
const safe=u=>{const{password,resetToken,resetExpiry,...rest}=u.toObject();return rest}
/* ── Nodemailer ── */
function mailer(){return nodemailer.createTransport({service:'gmail',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}})}
/* ── Register ── */
router.post('/register',async(req,res)=>{
  try{
    const{username,email,password}=req.body
    if(!username||!password)return res.status(400).json({error:'Username and password required'})
    if(password.length<1)return res.status(400).json({error:'Password cannot be empty'})
    const existing=await User.findOne({username:{$regex:`^${username.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,$options:'i'}})
    if(existing)return res.status(400).json({error:'Username already taken'})
    if(email){const dup=await User.findOne({email:email.toLowerCase()});if(dup)return res.status(400).json({error:'Email already registered'})}
    const user=await User.create({username,email:email||null,password})
    res.json({token:sign(user._id),user:safe(user)})
  }catch(e){res.status(400).json({error:e.code===11000?'Username or email already taken':e.message})}
})
/* ── Login (username or email) ── */
router.post('/login',async(req,res)=>{
  try{
    const{identifier,password}=req.body
    if(!identifier||!password)return res.status(400).json({error:'All fields required'})
    const user=await User.findOne({$or:[{email:identifier.toLowerCase()},{username:identifier}]})
    if(!user||!(await user.verifyPassword(password)))return res.status(400).json({error:'Invalid credentials'})
    const token=user.isAdmin?signAdmin(user._id,true):sign(user._id)
    res.json({token,user:safe(user)})
  }catch(e){res.status(400).json({error:e.message})}
})
/* ── Me ── */
router.get('/me',auth,async(req,res)=>{
  const user=await User.findById(req.user.id).select('-password -resetToken -resetExpiry')
  res.json(user)
})
/* ── Forgot Password ── */
router.post('/forgot-password',async(req,res)=>{
  try{
    const{email}=req.body
    if(!email)return res.status(400).json({error:'Email required'})
    const user=await User.findOne({email:email.toLowerCase()})
    if(!user)return res.json({message:'If that email is registered, a reset link was sent.'})
    const token=crypto.randomBytes(32).toString('hex')
    user.resetToken=token
    user.resetExpiry=new Date(Date.now()+3600000)
    await user.save()
    const link=`${process.env.FRONTEND_URL}/reset-password?token=${token}`
    await mailer().sendMail({from:`"Social Credit System" <${process.env.SMTP_USER}>`,to:email,subject:'☭ Password Reset Request',html:`<div style="background:#1a1a2e;color:#eee;padding:30px;font-family:monospace"><h2 style="color:#ff6b6b">☭ Social Credit System</h2><p>The Party has received your password reset request.</p><a href="${link}" style="background:#ff6b6b;color:#111;padding:10px 20px;text-decoration:none;display:inline-block;margin:16px 0">Reset Password</a><p>Expires in 1 hour. If you did not request this, the Party is watching.</p></div>`})
    res.json({message:'If that email is registered, a reset link was sent.'})
  }catch(e){res.status(500).json({error:'Email service unavailable'})}
})
/* ── Reset Password ── */
router.post('/reset-password',async(req,res)=>{
  try{
    const{token,password}=req.body
    if(!token||!password)return res.status(400).json({error:'Token and new password required'})
    const user=await User.findOne({resetToken:token,resetExpiry:{$gt:new Date()}})
    if(!user)return res.status(400).json({error:'Invalid or expired token'})
    user.password=password
    user.resetToken=null
    user.resetExpiry=null
    await user.save()
    res.json({message:'Password updated. You may now login.'})
  }catch(e){res.status(400).json({error:e.message})}
})
/* ── Check availability ── */
router.get('/check',async(req,res)=>{
  try{
    const{username,email}=req.query
    const result={}
    if(username){const u=await User.findOne({username:{$regex:`^${username.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,$options:'i'}}).select('_id').lean();result.usernameTaken=!!u}
    if(email){const u=await User.findOne({email:email.toLowerCase()}).select('_id').lean();result.emailTaken=!!u}
    res.json(result)
  }catch(e){res.status(500).json({error:e.message})}
})
module.exports=router