const router=require('express').Router()
const jwt=require('jsonwebtoken')
const crypto=require('crypto')
const nodemailer=require('nodemailer')
const auth=require('../middleware')
const {sign,signAdmin}=require('../middleware')
const {User}=require('../models')
const safe=u=>{const{password,resetToken,resetExpiry,...rest}=u.toObject();return rest}

/* ── Nodemailer ── */
// FIX: Use port 587 + STARTTLS (same as working PHP code).
//      Port 465/SSL hangs on Railway. Also strip spaces from the
//      app password in case .env preserves them, and add timeouts
//      so failures surface quickly instead of hanging forever.
function mailer(){
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,          // false = STARTTLS (upgraded after connect)
    requireTLS: true,       // refuse plain-text fallback
    auth: {
      user: process.env.SMTP_USER,
      pass: (process.env.SMTP_PASS||'').replace(/\s/g,'') // strip spaces from app password
    },
    connectionTimeout: 10000,  // 10 s to connect
    greetingTimeout:   8000,   // 8 s for EHLO
    socketTimeout:     15000,  // 15 s idle
    tls: { rejectUnauthorized: false }
  })
}

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

    // FIX: create the transporter once and verify it before sending,
    //      so connection errors are caught and reported immediately.
    const transport=mailer()
    await transport.verify()   // throws fast if credentials/network are wrong

    await transport.sendMail({
      from:`"Social Credit System" <${process.env.SMTP_USER}>`,
      to:email,
      subject:'☭ Password Reset Request',
      html:`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>@import url('https://fonts.googleapis.com/css2?family=MedievalSharp&family=IM+Fell+English:ital@0;1&family=Courier+Prime&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{background:#090909;font-family:'Courier Prime',monospace}table{width:100%}td{padding:0}</style></head><body><table width="100%" cellpadding="0" cellspacing="0" style="background:#090909;min-height:100vh"><tr><td align="center" style="padding:40px 20px"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%"><tr><td style="background:#0d0a0d;border:2px solid #5a3a4a;padding:0"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:6px;background:#0a070a"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #3a1f2a"><tr><td style="padding:6px;background:#090609"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px dashed #2a1520"><tr><td align="center" style="padding:36px 40px 28px"><p style="font-family:'Courier Prime',monospace;font-size:9px;letter-spacing:4px;text-transform:uppercase;color:#4a2a3a;margin-bottom:16px">SOCIAL CREDIT SYSTEM — DIRECTIVE</p><h1 style="font-family:'IM Fell English',serif;font-style:italic;font-size:32px;color:#b09898;letter-spacing:2px;text-shadow:0 0 30px #7a3a5a44;margin-bottom:8px">☭ Reset Order ☭</h1><div style="width:60px;height:1px;background:#5a3a4a;margin:0 auto 28px"></div><p style="font-family:'IM Fell English',serif;font-style:italic;font-size:14px;color:#8a6a6a;line-height:1.8;margin-bottom:28px">The Party acknowledges your request.<br>Your loyalty shall be restored.</p><a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#2a1520,#1a0d18);border:1px solid #7a4a5e;color:#c87a9a;font-family:'Courier Prime',monospace;font-size:11px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;padding:14px 32px;margin-bottom:28px">→ Restore Access ←</a><div style="width:60px;height:1px;background:#2a1520;margin:0 auto 24px"></div><p style="font-family:'Courier Prime',monospace;font-size:11px;color:#3a2a3a;line-height:1.7">This directive expires in one hour.<br>If you did not request this — the Party is already aware.</p></td></tr></table></td></tr></table></td></tr></table><tr><td align="center" style="padding:12px;border-top:1px solid #2a1520;background:#0a070a"><p style="font-family:'IM Fell English',serif;font-style:italic;font-size:11px;color:#3a2a3a">☭ &nbsp; glory to the collective &nbsp; ☭</p></td></tr></table></td></tr></table></td></tr></table></body></html>`
    })
    res.json({message:'If that email is registered, a reset link was sent.'})
  }catch(e){
    console.error('[forgot-password] mail error:',e.message)
    res.status(500).json({error:'Email service unavailable'})
  }
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
