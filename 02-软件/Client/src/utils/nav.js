/**
 * 返回上一页；上一页不存在就跳到兜底页。
 *
 * 为什么不直接 uni.navigateBack()：
 * uni-h5 的实现里做了个夹取 ——
 *     params.delta = Math.min(getCurrentPages().length - 1, value)
 * 页面栈里只有当前这一页时 len-1 = 0，delta 被夹成 0，于是「什么都不做」，
 * 既不报错也不弹提示，看上去就是返回键坏了。会踩到的情形：
 *   · H5 上刷新了当前页（栈被清空，只剩自己）
 *   · 直接开这个页面的 URL
 *   · 上一个页面是用 reLaunch 跳过来的（reLaunch 本来就会重置页面栈）
 *
 * 所以这里先看栈：有上一页就正常返回（保留真实的来路），
 * 没有才 reLaunch 到兜底页 —— 用 reLaunch 不用 navigateTo，
 * 是为了顺手把栈重置干净，免得越点越深、最后卡在页面上限上。
 *
 * @param {string} fallbackUrl 兜底页，一般填这个页面的上一层
 */
export const goBack = (fallbackUrl) => {
  if (getCurrentPages().length > 1) {
    uni.navigateBack()
    return
  }
  if (fallbackUrl) uni.reLaunch({ url: fallbackUrl })
}
