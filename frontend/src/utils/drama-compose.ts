// 时间段分镜（Seedance 2.0）共享逻辑：Beat 类型 / 默认时间段 / 剧创提示词拼装 / API 请求体预览 / 内置范例。
// 被 OmniWeaverPro 剧本编辑器镜头卡片（ShotStoryboardEditor）复用，与后端
// render_pipeline.build_beat_prompt 保持同款拼装规范（名称清单前缀 + beats 仅 time/action）。

// 结构化时间段分镜：action(运镜+动作)。sfx/voice/imageRef 为历史字段，仅为兼容旧存档保留，UI 不再写入。
// shotSize：景别（近景/远景/特写/标准），standard/缺省=默认不强调、不进提示词。
export interface Beat { time: string; action: string; sfx?: string; voice?: string; imageRef?: number; shotSize?: ShotSize }

// 景别映射（与后端 render_pipeline.SHOT_SIZE_CN 保持同款）；standard → 空（不强调）。
export type ShotSize = 'closeup' | 'wide' | 'extreme' | 'standard'
export const SHOT_SIZE_CN: Record<ShotSize, string> = {
  closeup: '近景',
  wide: '远景',
  extreme: '特写',
  standard: '',
}

// 顺时针视角名称（index 0..3 ↔ 角色图 slot 1..4）：与后端 ai_character_parser.VIEW_NAMES 同款。
export const VIEW_NAMES = ['特征图片', '肖像特写', '各种表情', '三个角度视图']

/** 按序号生成一张图的视角描述定义，如 viewCaption('林晚', 1) → '林晚的肖像特写'；超范围/空名返回空串。 */
export function viewCaption(name: string, index: number): string {
  const n = (name || '').trim()
  if (!n || index < 0 || index >= VIEW_NAMES.length) return ''
  return `${n}的${VIEW_NAMES[index]}`
}

/** 提示词里「图片N为「…」」中显示的图片名：角色图确保带上角色名（label 若已含角色名则不重复）。 */
export function promptImageName(im: { label?: string; name?: string; assetType?: 'character' | 'scene' | 'prop' }): string {
  const label = (im.label || '').trim()
  const charName = (im.name || '').trim()
  // 仅角色图需要强制带角色名；场景/道具沿用原 label
  if (im.assetType === 'character' && charName) {
    if (!label) return charName
    return label.includes(charName) ? label : `${charName}·${label}`
  }
  return label
}

// 生成默认时间段：按 2 秒一段覆盖 0..duration
export function defaultBeats(duration: number): Beat[] {
  const out: Beat[] = []
  for (let t = 0; t < duration; t += 2) {
    const end = Math.min(t + 2, duration)
    out.push({ time: `${t}-${end}s`, action: '' })
  }
  return out
}

// 解析创意文本里「明确的时间分镜」→ 按区隔机械填充 beats，绝不改写用户文字。
// 识别标记：首帧 / 尾帧 / 「N 秒」「N-M 秒」「第N秒」等（中英冒号、s/秒 通用）。
// 规则：
//   - 第一个时间标记之前的文字 → global（整体创意/视角/风格，作为一个或多个分镜的基础）。
//   - 每个时间标记切出一段 → 一个 beat：time 取标记的时间区间，action 为标记后的原文（逐字保留）。
//   - 首帧/尾帧无显式区间：首帧归到 0 起，尾帧归到末尾；区间按出现顺序与相邻段推断。
//   - duration = 所有 beat 的最大结束秒（无法推断则回退传入的 fallback）。
// 没有任何时间标记时返回 null，调用方据此回退到 AI 草拟。
export interface ParsedSegments { global: string; beats: Beat[]; duration: number }

// 单个时间标记（含其在原文中的位置与解析出的起止秒）
interface SegMark { start: number; end: number; from?: number; to?: number; kind: 'frame-first' | 'frame-last' | 'range' | 'point' }

const SEG_RE = /(首帧|尾帧|第\s*\d+(?:\.\d+)?\s*[-~到至]\s*\d+(?:\.\d+)?\s*[秒s]|第\s*\d+(?:\.\d+)?\s*[秒s]|\d+(?:\.\d+)?\s*[-~到至]\s*\d+(?:\.\d+)?\s*[秒s]|\d+(?:\.\d+)?\s*[秒s])/gi

function parseMark(raw: string): { from?: number; to?: number; kind: SegMark['kind'] } {
  const t = raw.replace(/第|\s/g, '')
  if (/首帧/.test(raw)) return { kind: 'frame-first' }
  if (/尾帧/.test(raw)) return { kind: 'frame-last' }
  const range = /(\d+(?:\.\d+)?)[-~到至](\d+(?:\.\d+)?)/.exec(t)
  if (range) return { from: parseFloat(range[1]), to: parseFloat(range[2]), kind: 'range' }
  const point = /(\d+(?:\.\d+)?)/.exec(t)
  if (point) return { from: parseFloat(point[1]), kind: 'point' }
  return { kind: 'point' }
}

export function parseExplicitSegments(text: string, fallbackDuration = 5): ParsedSegments | null {
  const src = (text || '').trim()
  if (!src) return null
  const marks: SegMark[] = []
  let m: RegExpExecArray | null
  SEG_RE.lastIndex = 0
  while ((m = SEG_RE.exec(src)) !== null) {
    const { from, to, kind } = parseMark(m[0])
    marks.push({ start: m.index, end: m.index + m[0].length, from, to, kind })
  }
  if (marks.length === 0) return null

  // global = 第一个标记之前的内容（去掉尾部的引导冒号）
  const global = src.slice(0, marks[0].start).trim().replace(/[，,；;：:。]+$/, '')

  // 切片：每个标记到下一个标记之间的原文为该段 action
  const rawSegs = marks.map((mk, i) => {
    const segEnd = i + 1 < marks.length ? marks[i + 1].start : src.length
    // action 去掉紧跟标记后的分隔符（：: ，, 空白），其余逐字保留
    const action = src.slice(mk.end, segEnd).replace(/^[\s：:，,、]+/, '').replace(/[；;。\s]+$/, '').trim()
    return { mk, action }
  })

  // 推断每段的起止秒。规则：
  //   - 首帧：起点 0；终点取下一段起点（无则 +2）。
  //   - 尾帧：若紧跟在已有区间之后且自身无显式区间 → 折叠进上一段（视为该段尾帧描述，逐字并入），不另立 beat、不增加时长。
  //   - range：直接用显式区间。
  //   - point：起点为该秒，终点取下一段起点（无则 +2）。
  type T = { from: number; to: number; action: string }
  const out: T[] = []
  let cursor = 0
  for (let i = 0; i < rawSegs.length; i++) {
    const { mk, action } = rawSegs[i]
    if (mk.kind === 'frame-last' && mk.from === undefined && out.length > 0) {
      // 折叠到上一段：逐字拼接，保留用户文字（先去掉上一段尾部分隔符，避免「，，」）
      const prev = out[out.length - 1]
      prev.action = [prev.action.replace(/[，,、；;\s]+$/, ''), action].filter(Boolean).join('，')
      continue
    }
    let from = mk.from
    let to = mk.to
    if (mk.kind === 'frame-first') from = from ?? 0
    if (from === undefined) from = cursor
    if (to === undefined) {
      const next = rawSegs[i + 1]?.mk
      to = next?.from !== undefined ? next.from : from + 2
    }
    if (to <= from) to = from + 1
    cursor = to
    out.push({ from, to, action })
  }

  const duration = Math.max(fallbackDuration, ...out.map(s => s.to))
  const beats: Beat[] = out.map(s => ({
    time: `${fmtSec(s.from)}-${fmtSec(s.to)}s`,
    action: s.action,
  }))
  return { global, beats, duration }
}

function fmtSec(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1)
}

// 扫描创意文本里引用的素材占位（图片N / 视频N / 音频N，中英数字、可带「第」），
// 用于在拆分时按文中引用预建空素材槽（让用户对照填充，不自动生成内容）。
//   - imageCount：文中出现的最大「图片N」序号（如出现 图片1、图片2 → 2）。
//   - hasVideo / hasAudio：是否引用了「视频N / 音频N」。
// 仅识别引用，不臆测数量；未引用则各为 0 / false。
export interface MaterialRefs { imageCount: number; hasVideo: boolean; hasAudio: boolean }
export function scanMaterialRefs(text: string): MaterialRefs {
  const src = text || ''
  let imageCount = 0
  const imgRe = /图片\s*(\d{1,2})/g
  let m: RegExpExecArray | null
  while ((m = imgRe.exec(src)) !== null) {
    const n = parseInt(m[1], 10)
    if (n > imageCount && n <= 20) imageCount = n
  }
  const hasVideo = /(参考)?视频\s*\d{0,2}/.test(src)
  const hasAudio = /(参考)?音频\s*\d{0,2}/.test(src)
  return { imageCount, hasVideo, hasAudio }
}

// 拼装「剧创提示词」：图片以「图片N」序号 + 名称代入（序号即提交给 API 的 content 顺序，
// 与 buildSeedancePreview / 后端 build_beat_prompt 保持一致，确保 API 正确区分每张图）。
// - 图片清单前缀：「图片1为「红苹果」、图片2为「奶盖」。」无名称的图仅写「图片N」。
// - 参考视频/音频：有则各加一行，带名称（无名称用通用措辞），以点到方式说明其作用。
// - beats 仅取 time + action（首帧/尾帧由用户在 action 文字中自行说明）。
export interface PromptImage { kind?: 'frame' | 'illustration'; label?: string; frame?: 'first' | 'last'; usage?: string; desc?: string; name?: string; assetType?: 'character' | 'scene' | 'prop' }
export interface PromptMaterial { label?: string }
export function buildPrompt(opts: {
  global: string
  beats: Beat[]
  images: PromptImage[]
  video?: PromptMaterial | null
  audio?: PromptMaterial | null
  // 整集级全局选项（关联素材按名称代入）
  composition?: string
  narration?: string
  bgm?: PromptMaterial | null
}): string {
  const lines: string[] = []

  // 图片清单：按顺序「图片N为「名称」」，序号与提交给 API 的图片顺序一一对应；首尾帧加标注
  // 角色图确保带上角色名（promptImageName），避免只显示视角描述行而丢失是谁。
  const roster = (opts.images || []).map((im, i) => {
    const name = promptImageName(im)
    const base = name ? `图片${i + 1}为「${name}」` : `图片${i + 1}`
    const fr = im.frame === 'first' ? '(首帧)' : im.frame === 'last' ? '(尾帧)' : ''
    return base + fr
  })
  if (roster.length) lines.push(`本镜参考图：${roster.join('、')}。`)

  // 配置元素的「形态/特征描述」：按描述内容去重，同一角色只输出一次「全片保持图片N…中角色的形象特征：<描述>。」
  // （同一角色多张视角图共享同一份 description，只写一次，避免成片提示词重复注入角色特征）
  // 每图的「形态/特征描述」：按描述内容去重，同一段描述只输出一次「全片保持图片N…形象特征：<描述>。」
  // 角色图带上角色名，确保成片提示词里能明确是谁的特征。
  const descGroups = new Map<string, { nums: number[]; charName: string }>()
  ;(opts.images || []).forEach((im, i) => {
    const desc = (im.desc || '').trim()
    if (!desc) return
    const g = descGroups.get(desc) || { nums: [], charName: '' }
    g.nums.push(i + 1)
    if (!g.charName && im.assetType === 'character' && (im.name || '').trim()) g.charName = (im.name || '').trim()
    descGroups.set(desc, g)
  })
  descGroups.forEach(({ nums, charName }, desc) => {
    const who = nums.map(n => `图片${n}`).join('、')
    const subject = charName ? `角色「${charName}」` : '中角色'
    lines.push(`全片保持${who}${subject}的形象特征：${desc}。`)
  })

  // 全局参考图的「用途/视角」：逐张输出「全程使用图片N「名称」<用途>。」
  // （对应整集素材库里给图片设的用途，如「第一视角构图」，让该约束贯穿全片）
  ;(opts.images || []).forEach((im, i) => {
    const usage = (im.usage || '').trim()
    if (!usage) return
    const name = (im.label || '').trim()
    const who = name ? `图片${i + 1}「${name}」` : `图片${i + 1}`
    lines.push(`全程使用${who}${usage}。`)
  })

  // 参考视频 / 参考音频（带名称代入，点到其作用）
  if (opts.video) {
    const vn = (opts.video.label || '').trim()
    lines.push(vn ? `参考视频「${vn}」：全程沿用其运镜构图。` : '参考视频：全程沿用其运镜构图。')
  }
  if (opts.audio) {
    const an = (opts.audio.label || '').trim()
    lines.push(an ? `参考音频「${an}」：全程作为背景音乐。` : '参考音频：全程作为背景音乐。')
  }

  // ── 整集级全局选项 ──
  const narration = (opts.narration || '').trim()
  if (narration) lines.push(`全片采用${narration}视角。`)
  const composition = (opts.composition || '').trim()
  if (composition) lines.push(`构图视角：${composition}。`)
  const bgmLabel = (opts.bgm?.label || '').trim()
  if (opts.bgm && bgmLabel) lines.push(`参考音频「${bgmLabel}」：全程作为背景音乐。`)

  const g = (opts.global || '').trim()
  if (g) lines.push(g)

  for (const b of opts.beats) {
    const a = (b.action || '').trim()
    if (!a) continue
    const t = (b.time || '').trim()
    const sz = b.shotSize && b.shotSize !== 'standard' ? SHOT_SIZE_CN[b.shotSize] : ''
    const body = sz ? `（${sz}）${a}` : a
    lines.push(t ? `${t}：${body}` : body)
  }
  return lines.join('\n')
}

// 还原「实际提交给 API 的请求体」：与 backend gateway/client.py:seedance_create 同款多模态
// content 结构。图片/视频/音频均以「经 proxy 服务发布的 MinIO 远程可访问 URL」下发（见后端
// /api/v1/drama/ref-asset），此处用占位符代替实际签名 URL，仅供查看请求形态。
// 图片顺序与 seedance_create 一致：严格按 images 数组顺序逐个下发，即「图片1、图片2…图片N」。
export interface SeedancePreview {
  model: string
  content: Array<Record<string, unknown>>
  ratio: string
  duration: number
  generate_audio: boolean
  watermark: boolean
}
export function buildSeedancePreview(opts: {
  prompt: string
  images: PromptImage[]
  video?: PromptMaterial | null
  audio?: PromptMaterial | null
  ratio: string
  duration: number
  model?: string
}): SeedancePreview {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: opts.prompt }]
  // 图片按数组顺序逐个下发，序号即「图片N」（与提示词、后端、API content 顺序完全一致）。
  ;(opts.images || []).forEach((im, i) => {
    const name = promptImageName(im)
    const who = name ? `图片${i + 1}·${name}` : `图片${i + 1}`
    content.push({
      type: 'image_url',
      role: 'reference_image',
      image_url: { url: `<${who} 的 proxy 远程 URL（/api/v1/drama/ref-asset 发布）>` },
    })
  })
  if (opts.video) {
    const vn = (opts.video.label || '').trim()
    content.push({
      type: 'video_url',
      role: 'reference_video',
      video_url: { url: `<参考视频${vn ? `「${vn}」` : ''} 的公网 URL>` },
    })
  }
  if (opts.audio) {
    const an = (opts.audio.label || '').trim()
    content.push({
      type: 'audio_url',
      role: 'reference_audio',
      audio_url: { url: `<参考音频${an ? `「${an}」` : ''} 的公网 URL>` },
    })
  }
  return {
    model: opts.model || 'seedance-2.0',
    content,
    ratio: opts.ratio,
    duration: opts.duration,
    generate_audio: false,
    watermark: false,
  }
}

// 内置范例模板（果茶第一人称广告）——一键填充编辑区，不含真实素材文件。
export interface Template {
  id: string
  name: string
  desc: string
  duration: number
  aspect: string
  unifyVoice: boolean
  generateAudio: boolean
  global: string
  beats: Beat[]
}

export const TEMPLATES: Template[] = [
  {
    id: 'fruit-tea',
    name: '果茶第一人称广告',
    desc: '第一人称视角 · 鲜切现摇 · 首尾帧定格 · 参考视频运镜 + 参考音频 BGM',
    duration: 8,
    aspect: '9:16',
    unifyVoice: true,
    generateAudio: true,
    global: 'seedance牌「苹苹安安」苹果果茶限定款，第一人称视角果茶宣传广告，鲜切现摇质感。',
    beats: [
      { time: '0-2s', action: '你的手摘下一颗带晨露的阿克苏红苹果', sfx: '轻脆的苹果碰撞声', voice: '' },
      { time: '2-4s', action: '快速切镜，你的手将苹果块投入雪克杯，加入冰块与茶底，用力摇晃', sfx: '冰块碰撞声与摇晃声卡点轻快鼓点', voice: '鲜切现摇' },
      { time: '4-6s', action: '第一人称成品特写，分层果茶倒入透明杯，你的手轻挤奶盖在顶部铺展，在杯身贴上粉红包标，镜头拉近看奶盖与果茶的分层纹理', sfx: '', voice: '' },
      { time: '6-8s', action: '第一人称手持举杯，将果茶举到镜头前（模拟递到观众面前的视角），杯身标签清晰可见', sfx: '', voice: '来一口鲜爽', imageRef: 2 },
    ],
  },
]
