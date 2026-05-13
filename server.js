require('dotenv').config()
const http=require('http')
const express=require('express')
const mongoose=require('mongoose')
const cors=require('cors')
const compression=require('compression')
const {WebSocketServer}=require('ws')
const jwt=require('jsonwebtoken')
const path=require('path')
const app=express()
app.use(compression())
app.use(cors({origin:process.env.FRONTEND_URL||'*',credentials:true}))
app.use(express.json({limit:'2mb'}))
app.use('/uploads',express.static(path.join(__dirname,'uploads')))
mongoose.connect(process.env.MONGO_URI,{maxPoolSize:20})
  .then(async()=>{console.log('DB connected');await seedAdmin()})
  .catch(e=>{console.error(e.message);process.exit(1)})
async function seedAdmin(){
  const{User}=require('./models')
  const username=process.env.ADMIN_SEED_USERNAME
  const password=process.env.ADMIN_SEED_PASSWORD
  if(!username||!password)return
  const exists=await User.findOne({username}).lean()
  if(!exists){await User.create({username,password,isAdmin:true,creditScore:999});console.log(`Admin created: ${username}`)}
  else if(!exists.isAdmin){await User.updateOne({username},{isAdmin:true});console.log(`Admin flag set on: ${username}`)}
}
app.use('/api/auth',require('./routes/auth'))
app.use('/api/posts',require('./routes/posts'))
app.use('/api/users',require('./routes/users'))
app.use('/api/groups',require('./routes/groups'))
app.use('/api/notifications',require('./routes/notifications'))
app.use('/api/chat',require('./routes/chat'))
app.use('/api/messages',require('./routes/messages'))
app.use('/api/commissariat',require('./routes/admin'))
app.get('/health',(_,res)=>res.json({ok:true}))
const server=http.createServer(app)
server.keepAliveTimeout=65000
server.headersTimeout=66000
const clients=new Map()
const profiles=new Map()
const typingTimers=new Map()
const wss=new WebSocketServer({server,path:'/ws'})
function _send(ws,data){if(ws.readyState===1)ws.send(JSON.stringify(data))}
function sendTo(uid,data){clients.get(String(uid))?.forEach(s=>_send(s,data))}
function broadcast(data,skip){
  const s=JSON.stringify(data)
  clients.forEach((sockets,uid)=>{if(uid!==skip)sockets.forEach(ws=>ws.readyState===1&&ws.send(s))})
}
function broadcastAll(data){
  const s=JSON.stringify(data)
  clients.forEach(sockets=>sockets.forEach(ws=>ws.readyState===1&&ws.send(s)))
}
function pushNotifCount(recipientId){
  const{Notification}=require('./models')
  Notification.countDocuments({recipient:recipientId,read:false}).then(count=>{
    sendTo(String(recipientId),{type:'notif_count',count})
  }).catch(()=>{})
}
wss.on('connection',async(ws,req)=>{
  let userId,user
  try{
    const tok=new URL(req.url,'http://x').searchParams.get('token')
    const decoded=jwt.verify(tok,process.env.LOYALTY_CIPHER_KEY)
    userId=String(decoded.id)
    const{User}=require('./models')
    user=await User.findById(userId).select('username avatar creditScore jailed jailUntil isAdmin').lean()
    if(!user)throw new Error()
  }catch{return ws.close(4001,'Unauthorized')}
  if(!clients.has(userId))clients.set(userId,new Set())
  clients.get(userId).add(ws)
  profiles.set(userId,{_id:userId,...user})
  _send(ws,{type:'ready',userId,online:[...profiles.values()]})
  broadcast({type:'user_online',user:profiles.get(userId)},userId)
  ws.on('message',async raw=>{
    let msg;try{msg=JSON.parse(raw)}catch{return}
    if(msg.type==='chat'){
      try{
        const{ChatMessage}=require('./models')
        const doc=await ChatMessage.create({author:userId,content:msg.content||'',attachments:(msg.attachments||[]).slice(0,3)})
        await doc.populate('author','username avatar creditScore jailed isAdmin')
        const out={type:'chat',msg:doc.toObject()}
        _send(ws,out);broadcast(out,userId)
      }catch(e){_send(ws,{type:'error',error:e.message})}
    }else if(msg.type==='dm'){
      try{
        const{Message}=require('./models')
        const toStr=String(msg.to)
        const saved=await Message.create({from:userId,to:toStr,content:msg.content||''})
        const relay={type:'dm',id:saved._id.toString(),dbId:saved._id.toString(),from:userId,fromUser:profiles.get(userId),content:msg.content||'',attachments:msg.attachments||[],ts:saved.createdAt.getTime()}
        if(clients.has(toStr))sendTo(toStr,relay)
        _send(ws,{type:'dm_sent',id:msg.id,dbId:saved._id.toString(),to:msg.to,ts:saved.createdAt.getTime()})
      }catch(e){_send(ws,{type:'error',error:e.message})}
    }else if(msg.type==='typing_dm'){
      const toStr=String(msg.to),key=`${userId}:${toStr}`
      clearTimeout(typingTimers.get(key))
      sendTo(toStr,{type:'typing_dm',from:userId,fromUser:profiles.get(userId)})
      typingTimers.set(key,setTimeout(()=>sendTo(toStr,{type:'stop_typing_dm',from:userId}),3000))
    }else if(msg.type==='typing_public'){
      const key=`pub:${userId}`
      clearTimeout(typingTimers.get(key))
      broadcast({type:'typing_public',from:userId,fromUser:profiles.get(userId)},userId)
      typingTimers.set(key,setTimeout(()=>broadcast({type:'stop_typing_public',from:userId},userId),3000))
    }else if(msg.type==='read_dm'){
      try{
        const{Message}=require('./models')
        const fromStr=String(msg.from)
        await Message.updateMany({from:fromStr,to:userId,read:false},{read:true})
        sendTo(userId,{type:'dm_read',from:fromStr})
      }catch{}
    }else if(msg.type==='admin_broadcast'){
      if(!profiles.get(userId)?.isAdmin)return
      broadcastAll({type:'public_warning',message:msg.message,from:profiles.get(userId),ts:Date.now()})
    }else if(msg.type==='ping'){
      _send(ws,{type:'pong'})
    }
  })
  ws.on('close',()=>{
    clients.get(userId)?.delete(ws)
    if(!clients.get(userId)?.size){
      clients.delete(userId);profiles.delete(userId)
      broadcast({type:'user_offline',userId},userId)
    }
  })
})
app.set('sendTo',sendTo)
app.set('broadcastAll',broadcastAll)
app.set('broadcast',broadcast)
app.set('pushNotifCount',pushNotifCount)
app.get('/api/ws/online',(_,res)=>res.json([...profiles.values()]))
const PORT=process.env.PORT||5000
server.listen(PORT,()=>console.log(`Running on ${PORT}`))
