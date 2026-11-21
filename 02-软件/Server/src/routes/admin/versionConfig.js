const express = require('express');
const router = express.Router();
const authAdmin = require('../../middleware/authAdmin');
const { VersionConfig, DEFAULT_RARITIES, DEFAULT_GRADES } = require('../../models/VersionConfig');

// 工具函数：格式化日期
const formatDate = (date) => {
  if (!date) return null;
  return new Date(date).toISOString();
};

// 工具函数：获取配置（如果不存在返回默认值）
const getConfigOrDefault = (config) => {
  if (!config) {
    return {
      rarities: DEFAULT_RARITIES,
      conditions: DEFAULT_CONDITIONS,
      grades: DEFAULT_GRADES,
      notes: ['9品', '8品', '7品', '6品', '5品'],
      defaultRarity: DEFAULT_RARITIES[1] || null,
      defaultCondition: DEFAULT_CONDITIONS[0] || null,
      defaultGrade: DEFAULT_GRADES[1]?.name || null,
      defaultNote: '9品'
    };
  }
  return {
    versionId: config.versionId,
    rarities: config.rarities,
    conditions: config.conditions || [],
    grades: config.grades,
    notes: config.notes || [],
    defaultRarity: config.defaultRarity,
    defaultCondition: config.defaultCondition || null,
    defaultGrade: config.defaultGrade,
    defaultNote: config.defaultNote || '',
    updatedAt: formatDate(config.updatedAt)
  };
};

// GET /v1/api/admin/version-config - 获取所有版本配置
router.get('/', authAdmin, async (req, res) => {
  try {
    const configs = await VersionConfig.find().sort({ versionId: 1 });
    const data = configs.map(config => getConfigOrDefault(config));
    res.json({ data });
  } catch (error) {
    console.error('Get all version configs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /v1/api/admin/version-config/:versionId - 获取单个版本配置
router.get('/:versionId', authAdmin, async (req, res) => {
  try {
    const { versionId } = req.params;
    const config = await VersionConfig.findOne({ versionId: parseInt(versionId) });
    
    if (!config) {
      return res.status(404).json({ error: 'Version config not found' });
    }
    
    res.json(getConfigOrDefault(config));
  } catch (error) {
    console.error('Get version config error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /v1/api/admin/version-config/:versionId - 创建/更新版本配置（upsert）
router.put('/:versionId', authAdmin, async (req, res) => {
  try {
    const { versionId } = req.params;
    const { rarities, conditions, grades, notes, defaultRarity, defaultCondition, defaultGrade, defaultNote } = req.body;
    const parsedVersionId = parseInt(versionId);

    const update = { versionId: parsedVersionId };
    if (rarities !== undefined) {
      if (!Array.isArray(rarities) || rarities.length === 0) return res.status(400).json({ error: 'rarities must have at least 1 item' });
      update.rarities = rarities;
      if (defaultRarity && !rarities.includes(defaultRarity)) return res.status(400).json({ error: 'defaultRarity must be in rarities list' });
      update.defaultRarity = defaultRarity || rarities[0];
    }
    if (grades !== undefined) {
      if (!Array.isArray(grades) || grades.length === 0) return res.status(400).json({ error: 'grades must have at least 1 item' });
      update.grades = grades;
      if (defaultGrade) { const gn = grades.map(g => g.name); if (!gn.includes(defaultGrade)) return res.status(400).json({ error: 'defaultGrade must be in grades list' }); }
      update.defaultGrade = defaultGrade || grades[0]?.name || null;
    }
    if (conditions !== undefined) {
      if (!Array.isArray(conditions) || conditions.length === 0) return res.status(400).json({ error: 'conditions must have at least 1 item' });
      update.conditions = conditions;
      if (defaultCondition !== undefined) update.defaultCondition = defaultCondition;
    }
    if (notes !== undefined) { update.notes = Array.isArray(notes) ? notes : []; }

    const config = await VersionConfig.findOneAndUpdate(
      { versionId: parsedVersionId },
      { $set: update },
      { upsert: true, new: true, runValidators: true }
    );

    res.json(getConfigOrDefault(config));
  } catch (error) {
    console.error('Update version config error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
