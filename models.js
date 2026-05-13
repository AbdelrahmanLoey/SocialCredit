const mongoose=require('mongoose')
const bcrypt=require('bcryptjs')
const {Schema,model}=mongoose
/* ── User ── */
const userSchema=new Schema({
  username:{type:String,required:true,unique:true,trim:true,maxlength:30},
  email:{type:String,unique:true,sparse:true,lowercase:true},
  password:{type:String,required:true},
  bio:{type:String,default:'',maxlength:200},
  avatar:{type:String,default:''},
  creditScore:{type:Number,default:100},
  comrades:[{type:Schema.Types.ObjectId,ref:'User'}],
  jailed:{type:Boolean,default:false},
  jailUntil:{type:Date,default:null},
  isAdmin:{type:Boolean,default:false},
  resetToken:{type:String,default:null},
  resetExpiry:{type:Date,default:null},
},{timestamps:true})
userSchema.pre('save',async function(next){if(this.isModified('password'))this.password=await bcrypt.hash(this.password,10);next()})
userSchema.methods.verifyPassword=function(p){return bcrypt.compare(p,this.password)}
userSchema.methods.isJailed=function(){return this.jailed||(this.jailUntil&&this.jailUntil>new Date())}
/* ── Post ── */
const postSchema=new Schema({
  author:{type:Schema.Types.ObjectId,ref:'User',required:true},
  content:{type:String,required:true,maxlength:500},
  image:{type:String,default:''},
  area:{type:String,enum:['public','smugglers','jail'],default:'public'},
  group:{type:Schema.Types.ObjectId,ref:'Group',default:null},
  upvotes:[{type:Schema.Types.ObjectId,ref:'User'}],
  downvotes:[{type:Schema.Types.ObjectId,ref:'User'}],
  reports:[{user:{type:Schema.Types.ObjectId,ref:'User'},reason:String,createdAt:{type:Date,default:Date.now}}],
  commentCount:{type:Number,default:0},
},{timestamps:true})
postSchema.index({area:1,createdAt:-1})
postSchema.index({author:1,area:1,createdAt:-1})
postSchema.index({group:1,createdAt:-1})
/* ── Comment ── */
const commentSchema=new Schema({
  post:{type:Schema.Types.ObjectId,ref:'Post',required:true},
  author:{type:Schema.Types.ObjectId,ref:'User',required:true},
  content:{type:String,required:true,maxlength:300},
  reports:[{user:{type:Schema.Types.ObjectId,ref:'User'},reason:String}],
},{timestamps:true})
commentSchema.index({post:1,createdAt:1})
/* ── Group ── */
const groupSchema=new Schema({
  name:{type:String,required:true,unique:true,trim:true},
  description:{type:String,default:'',maxlength:300},
  type:{type:String,enum:['public','smugglers'],default:'public'},
  creator:{type:Schema.Types.ObjectId,ref:'User'},
  members:[{type:Schema.Types.ObjectId,ref:'User'}],
  reports:[{user:{type:Schema.Types.ObjectId,ref:'User'},reason:String,createdAt:{type:Date,default:Date.now}}],
},{timestamps:true})
/* ── Notification ── */
const notificationSchema=new Schema({
  recipient:{type:Schema.Types.ObjectId,ref:'User',required:true},
  sender:{type:Schema.Types.ObjectId,ref:'User'},
  type:{type:String,enum:['upvote','downvote','report','comrade','group','messageReport','admin_warning','admin_jail','system']},
  post:{type:Schema.Types.ObjectId,ref:'Post',default:null},
  message:{type:String,default:''},
  read:{type:Boolean,default:false},
  groupKey:{type:String,default:''},
},{timestamps:true})
notificationSchema.index({recipient:1,createdAt:-1})
notificationSchema.index({recipient:1,read:1})
/* ── ChatMessage ── */
const chatMsgSchema=new Schema({
  author:{type:Schema.Types.ObjectId,ref:'User',required:true},
  content:{type:String,required:true,maxlength:1000},
  attachments:[{name:String,type:{type:String},url:String,size:Number}],
  isAdminWarning:{type:Boolean,default:false},
},{timestamps:true})
/* ── Message (DM) ── */
const messageSchema=new Schema({
  from:{type:Schema.Types.ObjectId,ref:'User',required:true},
  to:{type:Schema.Types.ObjectId,ref:'User',required:true},
  content:{type:String,maxlength:1000,default:''},
  attachments:[{name:String,type:{type:String},url:String,size:Number}],
},{timestamps:true})
messageSchema.index({from:1,to:1,createdAt:1})
module.exports={
  User:model('User',userSchema),
  Post:model('Post',postSchema),
  Comment:model('Comment',commentSchema),
  Group:model('Group',groupSchema),
  Notification:model('Notification',notificationSchema),
  ChatMessage:model('ChatMessage',chatMsgSchema),
  Message:model('Message',messageSchema),
}