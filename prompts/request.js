// Shared prompt assembly for Jev and OpenAI-compatible services.
// config.prompt is the effective prompt: the user's edit, or the default from config/<channel>/prompt.md.
function buildClassificationRequest(state, config, lottery) {
  const rules = config.prompt;
  const questions = {
    is_ad: {type: 'noul', instructions: rules + '\n返回广告概率。'},
    is_recruitment: {type: 'noul', instructions: rules + '\n返回真实岗位招聘概率。'},
    is_event: {type: 'noul', instructions: rules + '\n返回活动宣传概率。'}
  };
  const fields = ['ad_prob', 'recruitment_prob', 'event_prob'];
  if (lottery) {
    questions.giveaway_primary = {type: 'noul', instructions: rules + '\n按抽奖主次规则，返回主要抽奖的置信度。'};
    questions.giveaway_incidental = {type: 'noul', instructions: rules + '\n按抽奖主次规则，返回附带抽奖的置信度。'};
    fields.push('giveaway_primary_prob', 'giveaway_incidental_prob');
  }
  const output = `只输出 JSON，包含 ${fields.join(', ')}，各值均为 0 到 1 的数字。`;
  if (config.provider === 'custom' && config.apiProtocol === 'openai') {
    return {model: config.apiModel.trim(), messages: [
      {role: 'system', content: rules + '\n\n' + output},
      {role: 'user', content: JSON.stringify(state)}
    ]};
  }
  return {model: config.provider === 'custom' ? config.apiModel.trim() : 'jev-latest', state, questions};
}
