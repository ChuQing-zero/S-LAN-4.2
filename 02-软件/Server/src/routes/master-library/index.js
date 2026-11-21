const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const Card = require('../../models/Card');

/**
 * GET /v1/api/master-library/summary
 * 总管理库 — 跨分库按卡牌编号汇总
 * 查询参数:
 *   versionId  - 游戏版本过滤
 *   listed     - all | listed | unlisted
 *   rarity     - 罕贵度过滤（逗号分隔）
 *   search     - 卡牌编号/名称搜索
 *   page       - 页码 (默认1)
 *   pageSize   - 每页条数 (默认50)
 */
router.get('/summary', auth, async (req, res) => {
  try {
    const {
      versionId,
      listed = 'all',
      rarity,
      search,
      page = 1,
      pageSize = 50
    } = req.query;

    // 基础筛选：只查当前用户的卡牌
    const match = { userId: req.user.id };

    if (versionId) {
      match.versionId = Number(versionId);
    }

    if (listed === 'listed') {
      match.listed = true;
    } else if (listed === 'unlisted') {
      match.listed = false;
    }

    if (rarity) {
      const rarityList = rarity.split(',').map(r => r.trim());
      match.rarity = { $in: rarityList };
    }

    if (search) {
      match.$or = [
        { code: { $regex: search, $options: 'i' } },
        { jpName: { $regex: search, $options: 'i' } },
        { cnName: { $regex: search, $options: 'i' } }
      ];
    }

    // 聚合管道：按 code 分组
    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: '$code',
          jpName: { $first: '$jpName' },
          cnName: { $first: '$cnName' },
          totalCount: { $sum: 1 },
          listedCount: {
            $sum: { $cond: ['$listed', 1, 0] }
          },
          unlistedCount: {
            $sum: { $cond: ['$listed', 0, 1] }
          },
          // 收集所有子卡牌信息
          subCards: {
            $push: {
              cardId: '$_id',
              serial: '$serial',
              libraryCode: '$libraryCode',
              rarity: '$rarity',
              condition: '$condition',
              listed: '$listed',
              listingId: '$listingId',
              listedAt: '$listedAt',
              listedPrice: '$listedPrice',
              versionId: '$versionId',
              img: '$img'
            }
          },
          // 统计各罕贵度数量
          rarityMap: {
            $push: '$rarity'
          },
          // 统计各品相数量
          conditionMap: {
            $push: '$condition'
          }
        }
      },
      // 排除空卡牌编号的分组
      {
        $match: {
          _id: { $ne: '', $nin: ['...', '---', null] }
        }
      },
      { $sort: { _id: 1 } }
    ];

    const groups = await Card.aggregate(pipeline);

    // 后处理：将 rarityMap/conditionMap 转为计数对象
    const processed = groups.map(g => {
      const rarities = {};
      g.rarityMap.forEach(r => {
        if (r) rarities[r] = (rarities[r] || 0) + 1;
      });
      const conditions = {};
      g.conditionMap.forEach(c => {
        if (c) conditions[c] = (conditions[c] || 0) + 1;
      });
      return {
        code: g._id,
        jpName: g.jpName || '',
        cnName: g.cnName || '',
        totalCount: g.totalCount,
        listedCount: g.listedCount,
        unlistedCount: g.unlistedCount,
        rarities,
        conditions,
        subCards: g.subCards.sort((a, b) => a.serial.localeCompare(b.serial))
      };
    });

    // 分页
    const totalGroups = processed.length;
    const totalCards = processed.reduce((sum, g) => sum + g.totalCount, 0);
    const totalListed = processed.reduce((sum, g) => sum + g.listedCount, 0);
    const totalUnlisted = processed.reduce((sum, g) => sum + g.unlistedCount, 0);

    const p = Number(page);
    const ps = Number(pageSize);
    const start = (p - 1) * ps;
    const paged = processed.slice(start, start + ps);

    res.json({
      groups: paged,
      pagination: {
        page: p,
        pageSize: ps,
        totalGroups,
        totalPages: Math.ceil(totalGroups / ps)
      },
      stats: {
        totalCards,
        totalGroups,
        totalListed,
        totalUnlisted
      }
    });
  } catch (error) {
    console.error('[MasterLibrary] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /v1/api/master-library/mark-listed
 * 批量标记卡牌为已上架
 * Body: { cardIds: ["id1", "id2", ...], listingId?: "xxx" }
 */
router.put('/mark-listed', auth, async (req, res) => {
  try {
    const { cardIds, listingId } = req.body;
    if (!cardIds || !Array.isArray(cardIds) || cardIds.length === 0) {
      return res.status(400).json({ error: 'cardIds is required (array)' });
    }

    const result = await Card.updateMany(
      { _id: { $in: cardIds }, userId: req.user.id },
      {
        $set: {
          listed: true,
          // 写明是「主库」标的（V1.2.82）：一键上架的撤回只回收 `listedBy:'auto-listing'` 的卡，
          // 不带这枚字的人工标记它一概不碰 —— 这正是「撤回误抹人工标记」那个洞的修法
          // （人工标的卡被误抹 = 从凑库池里凭空消失，卡还在库里却凑不到订单）。
          // 这一笔同时是**进凑库池**：订单凑库只认 `listed:true`。
          listedBy: 'master-library',
          listedBatchId: null,
          listingId: listingId || null,
          listedAt: new Date()
        }
      }
    );

    res.json({
      success: true,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('[MasterLibrary] mark-listed Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /v1/api/master-library/mark-unlisted
 * 批量取消上架标记
 * Body: { cardIds: ["id1", "id2", ...] }
 */
router.put('/mark-unlisted', auth, async (req, res) => {
  try {
    const { cardIds } = req.body;
    if (!cardIds || !Array.isArray(cardIds) || cardIds.length === 0) {
      return res.status(400).json({ error: 'cardIds is required (array)' });
    }

    const result = await Card.updateMany(
      { _id: { $in: cardIds }, userId: req.user.id },
      {
        $set: {
          listed: false,
          // 取消标记必须**连身份一起清**（V1.2.82）。只清 listed 而留下 listedBy/listedBatchId 的话，
          // 这张卡日后被别的路径标回 listed:true 时身份还是旧的 —— 一键上架撤回时会照旧身份
          // 把它当"自己标的"收回去，等于换个条件重演同一个 bug（卡从凑库池里凭空消失）。
          listedBy: null,
          listedBatchId: null,
          listingId: null,
          listedAt: null,
          listedPrice: null
        }
      }
    );

    res.json({
      success: true,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('[MasterLibrary] mark-unlisted Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
