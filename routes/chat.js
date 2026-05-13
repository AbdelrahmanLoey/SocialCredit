const router = require('express').Router()
const auth = require('../middleware')
const { ChatMessage } = require('../models')
const { upload, processImage } = require('../utils/imgUpload')

/* GET chat history */
router.get('/', auth, async (req, res) => {
  try {
    const query = req.query.since ? { _id: { $gt: req.query.since } } : {}
    const msgs = await ChatMessage.find(query)
      .populate('author', 'username avatar creditScore jailed isAdmin')
      .sort({ createdAt: 1 }).limit(100).lean()
    res.json(msgs)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/* POST - send chat message with optional image (broadcasts via WS too) */
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const content = req.body.content || ''
    if (!content.trim() && !req.file) return res.status(400).json({ error: 'Empty' })

    let attachments = []
    if (req.file) {
      const url = await processImage(req.file.buffer)
      attachments = [{ name: req.file.originalname || 'image.webp', type: 'image/webp', url, size: req.file.size }]
    }

    const msg = await ChatMessage.create({ author: req.user.id, content, attachments })
    await msg.populate('author', 'username avatar creditScore jailed isAdmin')

    // Broadcast via WS so all connected clients receive the image message
    const broadcastAll = req.app.get('broadcastAll')
    if (broadcastAll) broadcastAll({ type: 'chat', msg: msg.toObject() })

    res.json(msg)
  } catch (e) { res.status(400).json({ error: e.message }) }
})

module.exports = router
