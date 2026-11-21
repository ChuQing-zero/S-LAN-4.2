/**
 * 日文注音（ルビ / furigana）转换工具
 * 将 漢字（かんじ） 格式转为 HTML <ruby> 标签，注音显示在汉字上方
 */

/**
 * 将日文名中的括号注音转为 ruby HTML
 * 输入: "墓（はか）場（ば）のゴースト王（おう）－パンプキング－"
 * 输出: "<ruby>墓<rt>はか</rt></ruby><ruby>場<rt>ば</rt></ruby>のゴースト<ruby>王<rt>おう</rt></ruby>－パンプキング－"
 */
export function toRubyHtml(text) {
  if (!text) return ''

  // 被注音的基础文本：汉字(CJK)、全角字母数字、半角字母数字、全半角符号
  // 不包括平假名/片假名，避免把「のゴースト」这类假名也包进 ruby
  const BASE_CHAR = '[一-鿿㐀-䶿豈-﫿０-９Ａ-Ｚａ-ｚA-Za-z0-9.·．]'

  // 注音内容：假名、字母、数字
  const RUBY_CHAR = '[^）)　 ]+'

  // 匹配：一个或多个基础字符 + 全角/半角括号 + 注音
  const re = new RegExp(`(${BASE_CHAR}+)[（(](${RUBY_CHAR})[）)]`, 'g')

  let result = ''
  let lastIndex = 0
  let match

  while ((match = re.exec(text)) !== null) {
    const base = match[1]
    const ruby = match[2]
    const start = match.index
    const end = match.index + match[0].length

    // 添加匹配之前的普通文本
    result += escapeHtml(text.slice(lastIndex, start))
    // 添加 ruby 标签
    result += `<ruby>${escapeHtml(base)}<rt>${escapeHtml(ruby)}</rt></ruby>`

    lastIndex = end
  }

  // 添加剩余文本
  result += escapeHtml(text.slice(lastIndex))

  return result
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
