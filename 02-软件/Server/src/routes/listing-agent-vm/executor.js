/**
 * VM 流程执行器 — 按步骤序列执行自动化操作
 * 对应 PC 版 executor.js, 使用 ADB 命令替代 pyautogui
 */
const sc = require('./screen')

// ===== 终止控制（按「运行标识」隔离）=====
//
// 原先是一个模块级的 `let _aborted = false` —— 一条全局的旗子。两种情况下会出错：
//   ① 急停是「谁点停谁全停」：手动面板点一下终止，正在跑的那一批也跟着停；
//   ② `executeSteps` 开头会 `resetAbort()`，所以**后开始的那次执行会顺手把前一次的
//      中止旗子清掉** —— 前一批永远停不下来。
// 现在键是运行标识（上架批次传 batchId；手动面板不传，落在空串这个槽里），
// 各停各的。不传参数的调用方（面板的终止按钮）只会停空串那一槽，也就是它自己起的那些。
const _aborted = new Set()

/** 发终止信号。runKey 不传 = 停「没有批次标识」的那些（手动面板自己起的） */
function abortExecution(runKey = '') { _aborted.add(runKey) }
function resetAbort(runKey = '') { _aborted.delete(runKey) }
function isAborted(runKey = '') { return _aborted.has(runKey) }

/** 变量替换 */
function replaceVariables(text, variables = {}) {
  if (!text) return text
  let result = text
  for (const [key, val] of Object.entries(variables)) {
    // 转义key中的正则特殊字符 (如括号)
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp('\\{\\{' + escaped + '\\}\\}', 'g'), String(val ?? ''))
  }
  return result
}

/**
 * 执行步骤序列。runKey = 本次运行的标识（上架批次传 batchId），终止信号按它隔离。
 *
 * `opts.keepAbort` —— **别清中止旗子**，默认 false（清，跟以前一样）。
 *
 * 为什么要有这个开关：下面那句 `resetAbort(runKey)` 是无条件的，而**整批上架是
 * 「每张卡调一次本函数、runKey 全是同一个 batchId」**。于是急停信号若恰好落在
 * 「上一张跑完、下一张刚进本函数」之间，这一清就把刚落下的急停**吞掉**了 ——
 * 用户按了停，后面每一张照跑，界面上还看不出为什么。
 * 所以整批上架改成：**开跑前清一次**（见 auto-execute-vm.js 里 `resetAbort(batchId)`），
 * 循环里每次都传 `keepAbort: true`。
 * 手动面板那条路（routes/listing-agent-vm/index.js 的 POST /execute）不传这个开关，
 * 行为跟以前一字不差 —— 它一次只跑一个流程，本来就没有这个竞态。
 */
async function executeSteps(steps, onLog, variables = {}, runKey = '', opts = {}) {
  const log = onLog || (() => {})
  if (!opts.keepAbort) resetAbort(runKey)

  for (let i = 0; i < steps.length; i++) {
    if (_aborted.has(runKey)) {
      log('⏹ 流程已被手动终止 (F1)')
      return { success: false, aborted: true, message: '手动终止', failed_step: i, total_steps: steps.length }
    }

    const step = steps[i]
    const idx = i + 1
    log(`[${idx}/${steps.length}] ${step.desc || step.type}`)

    const resolvedStep = { ...step }
    if (step.text) resolvedStep.text = replaceVariables(step.text, variables)
    if (step.scroll_clicks != null) resolvedStep.scroll_clicks = step.scroll_clicks

    try {
      switch (resolvedStep.type) {
        case 'click':
        case 'dblclick':
        case 'tplclick':
          let x = resolvedStep.x, y = resolvedStep.y
          // 运行时变量解析: _varName → 查variables值 → 匹配action name → 取坐标
          if (resolvedStep._varName) {
            const val = String(variables[resolvedStep._varName] || '')
            const match = (resolvedStep._actions || resolvedStep.actions || []).find(a => a.name === val)
            if (match) { x = match.x; y = match.y; log(`动态点击: ${resolvedStep._varName}=${val} → (${x},${y})`) }
            else { log(`动态点击失败: ${resolvedStep._varName}=${val} 无匹配action`); break }
          }
          if (resolvedStep._varX) x = parseInt(variables[resolvedStep._varX]) || x
          if (resolvedStep._varY) y = parseInt(variables[resolvedStep._varY]) || y
          if (resolvedStep.type === 'click') sc.clickAt(x, y)
          else if (resolvedStep.type === 'dblclick') sc.doubleClick(x, y)
          else sc.tripleClick(x, y)
          break

        case 'input':
          log(`输入: "${resolvedStep.text || ''}"`)
          sc.inputText(resolvedStep.text || '', resolvedStep.x ? Math.round(resolvedStep.x / 3) : 0, resolvedStep.y ? Math.round(resolvedStep.y / 1.125) : 0)
          break

        case 'press':
          log(`按键: ${resolvedStep.text || 'enter'}`)
          sc.pressKey(resolvedStep.text || 'enter')
          break

        case 'wait':
          log(`等待 ${resolvedStep.duration || 0.5}s`)
          // 这里同样是「必须 await」：wait 步骤动辄几秒，用忙等版会把事件循环占死，
          // 急停请求就递不进来了（同下面步骤间延迟那段注释）。
          await sc.sleepAsync((resolvedStep.duration || 0.5) * 1000)
          break

        case 'scroll':
          const hasXY = (resolvedStep.x1 != null) || (resolvedStep.y1 != null)
          if (hasXY) {
            const sx1 = resolvedStep.x1 ?? 360, sy1 = resolvedStep.y1 ?? 800
            const sx2 = resolvedStep.x2 ?? 360, sy2 = resolvedStep.y2 ?? 300
            const sms = resolvedStep.ms ?? 300
            log(`滑动 (${sx1},${sy1})→(${sx2},${sy2}) ${sms}ms`)
            sc.scroll({ x1: sx1, y1: sy1, x2: sx2, y2: sy2, ms: sms, clicks: resolvedStep.scroll_clicks || 500 })
          } else {
            log(`滚动 ${resolvedStep.scroll_clicks || -500}`)
            sc.scroll(resolvedStep.scroll_clicks || -500)
          }
          break

        case 'screenshot':
          log('截屏')
          sc.screenshot(resolvedStep.file || 'screen_vm.png')
          break

        case 'verify':
          log('验证页面...')
          const vr = sc.verify(resolvedStep.text || '')
          log(vr.success ? '✅ 验证通过' : '⚠️ 验证失败: ' + (vr.text || '').slice(0, 100))
          break

        case 'ocr-find-row':
          log('UIAutomator 识别行号...')
          const target = resolvedStep.text || variables['卡牌编号'] || ''
          const ir = sc.identifyRow(target)
          if (ir.found && ir.rows.length > 0) {
            const row = ir.rows[0].row
            variables['对应行数'] = String(row)
            log(`识别结果: 第 ${row} 行`)
          } else {
            log('⚠️ 未识别到行号')
          }
          break

        case 'compare':
          const cmpVar = step.compareVar ? step.compareVar.replace(/[{}]/g, '') : ''
          const rightVar = step.compareRightVar ? step.compareRightVar.replace(/[{}]/g, '') : ''
          // 注意: compareValue可能为合法空字符串'', 不能用||做默认值
          const cmpValue = rightVar ? (variables[rightVar] ?? '') : (step.compareValue ?? '')
          const op = step.compareOp || '=='
          let match = false
          if (op === '==') match = String(variables[cmpVar] || '') === String(cmpValue)
          else if (op === '!=') match = String(variables[cmpVar] || '') !== String(cmpValue)
          else if (op === '>') match = Number(variables[cmpVar] || 0) > Number(cmpValue)
          else if (op === '<') match = Number(variables[cmpVar] || 0) < Number(cmpValue)
          else if (op === '>=') match = Number(variables[cmpVar] || 0) >= Number(cmpValue)
          else if (op === '<=') match = Number(variables[cmpVar] || 0) <= Number(cmpValue)
          if (match && step.trueJump) {
            i = step.trueJump - 2
            log(`→ 跳转到步骤 ${step.trueJump}`)
          } else if (!match && step.falseJump) {
            i = step.falseJump - 2
            log(`→ 跳转到步骤 ${step.falseJump}`)
          }
          break

        case 'jump':
          if (step.jumpTo) {
            log(`跳转到步骤 ${step.jumpTo}`)
            i = step.jumpTo - 2
          }
          break

        case 'clean':
          for (const act of (step.actions || [])) {
            const iv = (act.inputVar || '').replace(/[{}]/g, '')  // 自动去{{}}
            const rm = act.remove || ''
            if (!iv || !rm) continue
            let val = String(variables[iv] || '')
            val = val.split(rm).join('')
            variables[iv] = isNaN(Number(val)) ? val : Number(val)
            log(`清理: "${String(variables[iv])}" → 去"${rm}" → ${iv}=${val}`)
          }
          break

        case 'extract':
          log('提取数据...')
          const dr = sc.dumpUI()
          const elems = dr.elements || []
          log(`  扫描到${elems.length}个元素`)
          if (elems.length === 0) { log('⚠️ 扫描失败'); break }
          for (const act of (step.actions || [])) {
            const outVar = (act.outputVar || '').replace(/[{}]/g, '')
            // 优先用关键词变量, 否则用手填
            let kw = act.keyword || ''
            const kwVar = (act.keywordVar || '').replace(/[{}]/g, '')
            if (kwVar && variables[kwVar] !== undefined) kw = String(variables[kwVar])
            if (!kw || !outVar) continue
            const kwEl = elems.find(e => e.text === kw)
            if (!kwEl) { log(`⚠️ 未找到: ${kw}`); continue }
            const kwIdx = elems.indexOf(kwEl)
            const offset = act.offset != null ? parseInt(act.offset) : 1
            let best = null
            const targetIdx = kwIdx + offset
            if (targetIdx >= 0 && targetIdx < elems.length) {
              best = elems[targetIdx]
            }
            if (best) {
              const raw = best.text || ''
              const pat = act.valuePattern || act.pattern || ''
              const val = pat ? (raw.match(new RegExp(pat))?.[1] || raw.match(new RegExp(pat))?.[0] || raw) : raw
              variables[outVar] = val
              log(`  提取: ${outVar} = ${val} (来源: ${kw})`)
            } else {
              log(`  提取失败: ${kw} 右侧未找到数值`)
            }
          }
          break

        case 'extract-row':
          log('提取行数...')
          const dr2 = sc.dumpUI()
          const elems2 = dr2.elements || []
          log(`  扫描到${elems2.length}个元素`)
          if (elems2.length === 0) { log('⚠️ 扫描失败'); break }
          for (const act of (step.actions || [])) {
            const outVar2 = (act.outputVar || '').replace(/[{}]/g, '')
            let kw2 = act.keyword || ''
            const kwVar2 = (act.keywordVar || '').replace(/[{}]/g, '')
            if (kwVar2 && variables[kwVar2] !== undefined) kw2 = String(variables[kwVar2])
            if (!kw2 || !outVar2) continue
            const offset2 = act.offset != null ? parseInt(act.offset) : 0
            const rows = []
            elems2.forEach((e, i) => {
              if (e.text === kw2) {
                rows.push(i + offset2)
              }
            })
            if (rows.length === 0) {
              log(`⚠️ 未找到: ${kw2}`)
            } else {
              variables[outVar2] = rows.join(', ')
              log(`  提取行数: ${outVar2} = ${variables[outVar2]} (来源: ${kw2}, 匹配${rows.length}个)`)
            }
          }
          break

        case 'jump':
          // 跳转 — 由调用方处理
          break

        case 'setvar':
          const slv = step.leftVar || ''
          const srv = step.rightVar || ''
          const stpl = step.template || ''
          if (slv) {
            if (stpl) {
              // 模板模式: {{卡牌编号}}({{异画}}) → 替换后赋值
              variables[slv] = replaceVariables(stpl, variables)
            } else if (srv && variables[srv] !== undefined) {
              // 复制模式: leftVar = variables[rightVar]
              variables[slv] = variables[srv]
            }
            log(`设置变量: ${slv} = ${variables[slv]}`)
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
              // eval 失败时退回字符串
              variables[clv] = expr
              log(`计算失败, 退回字符串: ${clv} = ${expr}`)
            }
          }
          break

        case 'find-click': {
          const kw = resolvedStep.keyword || resolvedStep.text || ''
          log('精准点击: "' + kw + '"')
          const fcRes = sc.findAndTap(kw)
          if (fcRes.ok) log('  已点击 ' + kw + ' (' + (fcRes.tap||[]).join(',') + ')')
          else log('  ⚠️ 未找到: ' + kw)
          break
        }

        case 'end':
          log('流程结束')
          return { success: true, aborted: false, message: '流程结束', failed_step: -1, total_steps: steps.length }

        default:
          log(`⚠️ 未知步骤类型: ${resolvedStep.type}`)
      }
      // 步骤间延迟
      //
      // 这里**必须 await**。原先调的是 `sc.sleep(delay)` —— 而它是忙等
      // (`while (Date.now() < end) {}`)，且调用处没 await：整趟流程从头到尾占着事件循环，
      // 一个 tick 都不让出来。后果是急停请求**根本递不进来**（服务器还在跑上一个请求，
      // 新连接排不上），「终止按钮」是个摆设。换成 sleepAsync 之后每步之间让出一次事件循环，
      // 终止请求就有机会被处理了。
      // 剩下的局限：单个 execSync（dumpUI / screenshot）自身仍会阻塞几百毫秒到一秒，
      // 所以要停也是「当前这一步做完」才停 —— 这和按钮上写的文案一致。
      const delay = (resolvedStep.duration || 0.3) * 1000
      if (delay > 0) await sc.sleepAsync(delay)
    } catch (e) {
      log(`❌ 步骤失败: ${e.message}`)
      return { success: false, aborted: false, message: e.message, failed_step: i, total_steps: steps.length }
    }
  }

  return { success: true, aborted: false, message: 'OK', total_steps: steps.length }
}

module.exports = { executeSteps, replaceVariables, abortExecution, resetAbort, isAborted }
