const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { VersionConfig, DEFAULT_RARITIES, DEFAULT_CONDITIONS, DEFAULT_GRADES } = require('../../models/VersionConfig');

// GET /v1/api/rarities - 罕贵度列表
router.get('/rarities', auth, async (req, res) => {
  try {
    const { versionId } = req.query;
    
    let rarities = [...DEFAULT_RARITIES];
    let defaultRarity = DEFAULT_RARITIES[1] || null;

    // 如果指定了 versionId，尝试从数据库获取配置
    if (versionId) {
      const config = await VersionConfig.findOne({ versionId: parseInt(versionId) });
      if (config) {
        rarities = config.rarities;
        defaultRarity = config.defaultRarity || rarities[1] || null;
      }
    }

    res.json({ 
      list: rarities,
      default: defaultRarity
    });
  } catch (error) {
    console.error('Get rarities error:', error);
    // 出错时返回默认值
    res.json({ 
      list: DEFAULT_RARITIES,
      default: DEFAULT_RARITIES[1] || null
    });
  }
});

// GET /v1/api/grades - 品相列表
router.get('/grades', auth, async (req, res) => {
  try {
    const { versionId } = req.query;
    
    let grades = [...DEFAULT_GRADES];
    let defaultGrade = DEFAULT_GRADES[1]?.name || null;

    // 如果指定了 versionId，尝试从数据库获取配置
    if (versionId) {
      const config = await VersionConfig.findOne({ versionId: parseInt(versionId) });
      if (config) {
        grades = config.grades;
        defaultGrade = config.defaultGrade || grades[1]?.name || null;
      }
    }

    res.json({ 
      list: grades,
      default: defaultGrade
    });
  } catch (error) {
    console.error('Get grades error:', error);
    // 出错时返回默认值
    res.json({ 
      list: DEFAULT_GRADES,
      default: DEFAULT_GRADES[1]?.name || null
    });
  }
});

// GET /v1/api/conditions - 品相列表
router.get('/conditions', auth, async (req, res) => {
  try {
    const { versionId } = req.query;
    let conditions = [...DEFAULT_CONDITIONS];
    let defaultCondition = DEFAULT_CONDITIONS[0];
    if (versionId) {
      const config = await VersionConfig.findOne({ versionId: parseInt(versionId) });
      if (config && config.conditions && config.conditions.length > 0) {
        conditions = config.conditions;
        defaultCondition = config.defaultCondition || conditions[0];
      }
    }
    res.json({ list: conditions, default: defaultCondition });
  } catch (e) {
    res.json({ list: DEFAULT_CONDITIONS, default: DEFAULT_CONDITIONS[0] });
  }
});

// GET /v1/api/notes - 备注列表
router.get('/notes', auth, async (req, res) => {
  try {
    const { versionId } = req.query;
    let notes = ['9品', '8品', '7品', '6品', '5品'];
    let defaultNote = '9品';
    if (versionId) {
      const config = await VersionConfig.findOne({ versionId: parseInt(versionId) });
      if (config && config.notes && config.notes.length > 0) {
        notes = config.notes;
        defaultNote = config.defaultNote || notes[0];
      }
    }
    res.json({ list: notes, default: defaultNote });
  } catch (e) {
    res.json({ list: ['9品', '8品', '7品', '6品', '5品'], default: '9品' });
  }
});

// GET /v1/api/grades/psa - 评级卡(已废弃，返回空)
router.get('/grades/psa', auth, (req, res) => {
  res.json({ list: [] });
});

module.exports = router;
