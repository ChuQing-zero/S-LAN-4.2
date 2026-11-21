/**
 * 流程执行器 — 按步骤序列执行自动化操作
 * 支持变量替换、OCR识别、条件判断
 */
const sc = require('./screen')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// ===== 终止控制（按「运行标识」隔离，和 VM 版逐字一个口径）=====
//
// 原先是一条全局旗子，两个毛病：急停会「谁点停谁全停」；而且 executeSteps 开头的
// resetAbort() 会让**后开始的那次执行把前一次的中止旗子清掉**，前一批永远停不下来。
// 现在键是运行标识（上架批次传 batchId；手动面板不传，落在空串那一槽），各停各的。
const _aborted = new Set()

/** 发终止信号。runKey 不传 = 停「没有批次标识」的那些（手动面板自己起的） */
function abortExecution(runKey = '') { _aborted.add(runKey) }

/** 重置终止标志（每次执行前调用） */
function resetAbort(runKey = '') { _aborted.delete(runKey) }

/** 检查是否已终止 */
function isAborted(runKey = '') { return _aborted.has(runKey) }

/**
 * 执行步骤序列。runKey = 本次运行的标识（上架批次传 batchId），终止信号按它隔离。
 *
 * `opts.keepAbort` —— **别清中止旗子**，默认 false（清，跟以前一样）。理由跟 VM 版一字不差：
 * 整批上架是「每张卡调一次本函数、runKey 全是同一个 batchId」，而下面那句 resetAbort 是无条件的；
 * 急停若落在「上一张跑完、下一张刚进本函数」之间，这一清就把刚落下的急停吞掉了。
 * 所以整批上架改成开跑前清一次（见 routes/listings/auto-execute.js），循环里传 `keepAbort: true`。
 */
async function executeSteps(steps, onLog, variables = {}, runKey = '', opts = {}) {
  const log = onLog || (() => {})
  if (!opts.keepAbort) resetAbort(runKey)

  for (let i = 0; i < steps.length; i++) {
    // 每步之前检查终止标志
    if (_aborted.has(runKey)) {
      log('⏹ 流程已被用户手动终止 (F1)')
      return { success: false, aborted: true, message: '用户手动终止', failed_step: i, total_steps: steps.length }
    }

    const step = steps[i]
    const idx = i + 1
    log(`[${idx}/${steps.length}] ${step.description || step.type}`)

    // 动态替换变量（支持OCR后更新的变量）
    const resolvedStep = { ...step }
    if (step.text) resolvedStep.text = replaceVariables(step.text, variables)
    if (step.x != null) resolvedStep.x = step.x
    if (step.y != null) resolvedStep.y = step.y

    try {
      switch (resolvedStep.type) {
        case 'click':
        case 'dblclick':
        case 'tplclick':
          // 支持变量替换后的坐标（用于对应行数等动态步骤）
          let x = resolvedStep.x, y = resolvedStep.y
          if (resolvedStep._varX) x = parseInt(variables[resolvedStep._varX]) || x
          if (resolvedStep._varY) y = parseInt(variables[resolvedStep._varY]) || y
          if (resolvedStep.type === 'click') await sc.clickAt(x, y)
          else if (resolvedStep.type === 'dblclick') await sc.doubleClick(x, y)
          else await sc.tripleClick(x, y)
          break
        case 'input':
          log(`输入文本: "${resolvedStep.text || ''}"`)
          await sc.inputText(resolvedStep.text || '', resolvedStep.x, resolvedStep.y)
          break
        case 'press':
          await sc.pressKey(resolvedStep.text || resolvedStep.key || '')
          break
        case 'scroll':
          await sc.scroll(resolvedStep.scroll_clicks || resolvedStep.y || 0)
          break
        case 'drag':
          await sc.drag(resolvedStep.x1, resolvedStep.y1, resolvedStep.x2, resolvedStep.y2)
          break
        case 'wait':
          await sc.waitMs((resolvedStep.duration || 0.5) * 1000)
          break
        case 'screenshot':
          const img = await sc.captureScreen()
          log(`截屏: ${img ? img.length + ' bytes' : '失败'}`)
          break
        case 'ocr-find-row':
          // OCR识别行号：截图 → Vision直接识别
          const rowNum = await doOcrFindRow(resolvedStep, variables, log)
          if (resolvedStep.variable) {
            variables[resolvedStep.variable] = String(rowNum)
            log(`OCR识别结果: 第${rowNum}行 → 变量 ${resolvedStep.variable}=${rowNum}`)
          }
          break
        case '_dynamic_click':
          // OCR后点击对应行：根据变量值从_actions中查找action
          const varName = resolvedStep._varName
          const rowVal = variables[varName]
          if (rowVal && resolvedStep._actions) {
            const act = resolvedStep._actions.find(a => a.name === String(rowVal))
            if (act) {
              const clickType = resolvedStep._clickType || 'click'
              if (clickType === 'dblclick') await sc.doubleClick(act.x, act.y)
              else if (clickType === 'tplclick') await sc.tripleClick(act.x, act.y)
              else await sc.clickAt(act.x, act.y)
              log(`动态点击(${clickType}): ${varName}=${rowVal} → (${act.x},${act.y})`)
            } else {
              log(`未找到行${rowVal}的坐标`)
            }
          }
          break
        case 'compare':
          // 比较变量值，根据结果跳转
          const cmpVar = resolvedStep.compareVar ? resolvedStep.compareVar.replace(/[{}]/g, '') : ''
          const varValue = variables[cmpVar] || '0'
          const rightVar = resolvedStep.compareRightVar ? resolvedStep.compareRightVar.replace(/[{}]/g, '') : ''
          // 优先与右变量比较，右变量为空则用固定值
          const cmpValue = rightVar ? (variables[rightVar] || '0') : (resolvedStep.compareValue || '0')
          const op = resolvedStep.compareOp || '=='

          let result = false
          const vn = parseFloat(varValue), cn = parseFloat(cmpValue)
          if (op === '==') result = varValue == cmpValue
          else if (op === '!=') result = varValue != cmpValue
          else if (op === '>') result = vn > cn
          else if (op === '<') result = vn < cn
          else if (op === '>=') result = vn >= cn
          else if (op === '<=') result = vn <= cn

          log(`比较: ${cmpVar}(${varValue}) ${op} ${rightVar ? rightVar+'('+cmpValue+')' : cmpValue} → ${result}`)

          if (result && resolvedStep.trueJump) {
            i = resolvedStep.trueJump - 2  // -2 because loop will i++ after
            log(`→ 跳转到步骤 ${resolvedStep.trueJump}`)
          } else if (!result && resolvedStep.falseJump) {
            i = resolvedStep.falseJump - 2
            log(`→ 跳转到步骤 ${resolvedStep.falseJump}`)
          }
          break
        case 'jump':
          // 无条件跳转
          if (resolvedStep.jumpTo) {
            log(`跳转到步骤 ${resolvedStep.jumpTo}`)
            i = resolvedStep.jumpTo - 2  // -2 because loop will i++ after
          }
          break
        case 'setvar':
          // 设置变量: 模板模式 or 简单赋值
          const lv = resolvedStep.leftVar
          const template = resolvedStep.template || ''
          if (lv) {
            if (template) {
              // 模板模式: 替换所有 {{var}} → 实际值 → 去掉空括号
              let result = template
              for (const [key, value] of Object.entries(variables)) {
                result = result.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), value || '')
              }
              // 去掉空的括号 () 、(  ) 等
              result = result.replace(/\(\s*\)/g, '')
              // 去掉多余空格
              result = result.trim()
              variables[lv] = result
              log(`字符串组合: ${lv} = "${template}" → "${result}"`)
            } else {
              // 简单赋值: leftVar = rightVar
              const rv = resolvedStep.rightVar
              if (rv) {
                const rvVal = variables[rv] || ''
                variables[lv] = rvVal
                log(`设置变量: ${lv} = ${rv}(${rvVal})`)
              }
            }
          }
          break
        case 'compute':
          const clv = (step.leftVar || '').replace(/[{}]/g, '')
          const ctv = step.template || step.rightVar || ''
          if (clv) {
            const expr = replaceVariables(ctv, variables)
            try {
              variables[clv] = eval(expr)
              log(`计算: ${clv} = ${expr} → ${variables[clv]}`)
            } catch (e) {
              variables[clv] = expr
            }
          }
          break
        default:
          log(`未知步骤类型: ${resolvedStep.type}`)
      }

      // 步骤间延迟
      const delay = (step.duration || 0.3) * 1000
      if (delay > 0) await sc.waitMs(delay)

    } catch (e) {
      log(`❌ 第${idx}步失败: ${e.message}`)
      return { success: false, message: e.message, failed_step: idx - 1, total_steps: steps.length }
    }
  }

  return { success: true, total_steps: steps.length, variables }
}

/** OCR识别行号：截图 → 豆包 Vision 直接识别 */
async function doOcrFindRow(step, variables, log) {
  const { x1, y1, x2, y2, ocrPrompt } = step

  // 读取缩放校准
  let scaleX = 1, scaleY = 1
  try {
    const calib = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/screen-calib.json'), 'utf-8'))
    scaleX = calib.scaleX || 1
    scaleY = calib.scaleY || 1
  } catch (_) {}

  // 等待页面渲染完成（前一步点击后需要时间加载）
  await sc.waitMs(1500)

  // 截取区域（带缩放校正）
  const { execSync } = require('child_process')
  const tmpCrop = path.join(__dirname, '../../temp_ocr_crop.png')

  const psCmd = `
Add-Type -AssemblyName System.Drawing;
$scaleX = ${scaleX}; $scaleY = ${scaleY};
$px1 = [int](${x1} * $scaleX); $py1 = [int](${y1} * $scaleY);
$px2 = [int](${x2} * $scaleX); $py2 = [int](${y2} * $scaleY);
$pw = $px2 - $px1; $ph = $py2 - $py1;
$bmp = New-Object System.Drawing.Bitmap($pw, $ph);
$g = [System.Drawing.Graphics]::FromImage($bmp);
$g.CopyFromScreen($px1, $py1, 0, 0, (New-Object System.Drawing.Size($pw, $ph)));
$g.Dispose();
$bmp.Save('${tmpCrop.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png);
$bmp.Dispose();
`
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCmd.replace(/\n/g, ' ')}"`, { timeout: 10000 })

  // 图片转 base64
  const imgBuf = fs.readFileSync(tmpCrop)
  const imgBase64 = imgBuf.toString('base64')

  // 豆包 Vision 直接识别
  const prompt = replaceVariables(ocrPrompt || '查看图片内每行卡牌，找到品相右侧竖线|后面数字或文字等于{{品相备注}}的条目，只输出对应行号纯数字', variables)
  const rowNum = await callVisionForRow(imgBase64, prompt, variables, log)

  // 清理
  try { fs.unlinkSync(tmpCrop) } catch (_) {}

  return rowNum
}

/** 调用豆包 Vision 直接看图识别行号 */
async function callVisionForRow(imgBase64, prompt, variables, log) {
  const axios = require('axios')
  const config = require('../../config')

  try {
    const res = await axios.post('https://ark.cn-beijing.volces.com/api/v3/responses', {
      model: config.ark.model,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: 'data:image/png;base64,' + imgBase64 }
        ]
      }]
    }, {
      headers: { 'Authorization': 'Bearer ' + config.ark.apiKey, 'Content-Type': 'application/json' },
      timeout: 60000
    })
    const data = res.data
    const msgOutput = data?.output?.find(o => o.type === 'message')
    const content = (msgOutput?.content?.[0]?.text || '').trim()
    log(`Vision返回: "${content.slice(0, 200)}"`)

    // 正则提取所有备注数字
    // 兼容可能的编码问题：尝试多个 key 名
    let targetNote = parseInt(variables['品相备注']) || parseInt(variables['卡牌品相备注']) || 0
    // 如果品相备注不在 variables 中，从 ocrPrompt 中提取数字
    if (!targetNote && prompt) {
      const pm = prompt.match(/等于(\d+)/) || prompt.match(/备注.*?(\d+)/)
      if (pm) targetNote = parseInt(pm[1])
    }
    const notes = []

    // 方法1: |数字 或 数量数字
    const pat1 = /[\|数量]\s*(\d+)/g
    let m
    while ((m = pat1.exec(content)) !== null) {
      const n = parseInt(m[1])
      if (!notes.includes(n) && n > 0 && n < 1000) notes.push(n)
    }

    // 方法2: 顿号/逗号分隔的数字列表（如：分别为：1、5、4、89、6、99、2）
    if (notes.length === 0) {
      const pat2 = /(\d+)[、,，]\s*(\d+)/g
      while ((m = pat2.exec(content)) !== null) {
        // 提取整个数字序列
        const afterColon = content.slice(m.index - 30, m.index + 200)
        const allNums = afterColon.match(/\d+/g)
        if (allNums && allNums.length >= 3) {
          allNums.forEach(s => {
            const n = parseInt(s)
            if (!notes.includes(n) && n > 0 && n < 1000) notes.push(n)
          })
        }
      }
    }

    log(`提取备注: [${notes.join(', ')}]`)
    const rowIdx = notes.indexOf(targetNote)
    const rowNum = rowIdx >= 0 ? rowIdx + 1 : 0
    log(`目标${targetNote} → 索引${rowIdx} → 行号${rowNum}`)
    return rowNum
  } catch (e) {
    log(`Vision调用失败: ${e.message}`)
    return 0
  }
}

/** 替换变量 */
function replaceVariables(text, variables) {
  if (!text) return text
  let result = text
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), value || '')
  }
  return result
}

module.exports = { executeSteps, replaceVariables, abortExecution, resetAbort, isAborted }
