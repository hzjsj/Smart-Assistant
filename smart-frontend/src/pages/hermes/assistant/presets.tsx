import {
  ApartmentOutlined,
  BookOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  EditOutlined,
  FileTextOutlined,
  HighlightOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import React from 'react';
import type { AssistantPreset } from './types';

/**
 * 复用的作文输入插槽：
 * - title：作文标题（≤20 字）
 * - body：作文正文（开头/主体/结尾）
 * 插槽数组必须是模块级稳定引用——Sender 的 slotConfig 按引用变化重建插槽。
 */
const titleSlot = (defaultValue?: string) => ({
  type: 'content' as const,
  key: 'title',
  props: {
    placeholder: '请填写作文的标题，字数不超过20个字',
    ...(defaultValue ? { defaultValue } : {}),
  },
});

const bodySlot = (defaultValue?: string) => ({
  type: 'content' as const,
  key: 'body',
  props: {
    placeholder: '请填写作文的内容，可以包括作文的开头、主体和结尾等部分',
    ...(defaultValue ? { defaultValue } : {}),
  },
});

/** 「说明 → 题目 → 文章」通用模板（批改/评分/讲解/润色/结构建议共用）。 */
const withTitleAndBody = (intro: string, title?: string, body?: string) => [
  { type: 'text' as const, value: `${intro}\n题目：` },
  titleSlot(title),
  { type: 'text' as const, value: '\n文章：' },
  bodySlot(body),
];

/* ------------------------------ 示例范文 ------------------------------ */

const BEIJING_AUTUMN = `秋风送爽，丹桂飘香，又是一个丰收的季节！在这个收获的季节里，我们来到了美丽的首都——北京。

来到北京的第一天，我们就去了颐和园。刚进门就看见了那条长长的昆明湖，湖水碧绿清澈，在阳光下闪着耀眼的光芒;微风吹过，泛起层层涟漪，像一面巨大的银镜。这真是“接天莲叶无穷碧，映日荷花别样红”呀！再往前走就是万寿山了，拾阶而上，登到最高处，就可以俯瞰整个颐和园的美景啦！往下看去，只见远处的佛香阁金光闪闪，就像一个大大的宝塔立于水中;近处的十七孔桥横跨两岸，犹如一条玉带连接东西;还有那些小岛、亭台楼阁点缀其间......真是一幅美丽的水墨画啊！

第二天早上，我们乘车前往八达岭长城。站在长城脚下抬头仰望，好雄伟的长城呀！它蜿蜒曲折地伸向远方，好像一条巨龙卧伏在大地上。沿着陡峭的石梯向上攀爬，虽然有些累，但当我们看到万里长城的壮观景象时，觉得一切都是值得的。站在这座历史悠久的世界奇迹面前，我不禁感叹道：“不到长城非好汉！”

第三天上午，我们参观了故宫博物院。这里曾是中国封建社会的皇家宫殿，现在已经成为了一座博物馆。走进午门，首先映入眼帘的是太和殿广场上的三大殿，它们分别是太和殿、中和殿和保和殿。这三座宏伟的大殿气势磅礴，让我不由得想起了古代皇帝举行盛典时的场景。继续向前走，就来到了乾清宫、坤宁宫等后宫区域。这些地方曾经住着许多妃子们，她们在这里生活、工作、争宠......看着这一件件文物，仿佛能听到当年宫廷里的欢声笑语与哭泣哀嚎。

这次北京之行，不仅让我们领略了祖国的大好河山，还增长了不少知识呢！`;

const AUTUMN_BEIJING = `秋天到了，树叶黄了，风儿吹过，一片片金色的叶子从空中飘下来，像一只只蝴蝶在翩翩起舞。

公园里，菊花开了，五颜六色，争奇斗艳，有的红如火焰;有的白似雪花;还有的粉得像霞光一样美丽！一阵阵清香扑鼻而来，沁人心脾，令人陶醉其中。小草也脱下了绿衣裳，穿上了金灿灿的外套，显得格外精神。

果园里的苹果露出了红彤彤的小脸蛋，梨子挂满了枝头，就像一个个葫芦娃，葡萄架上结满了紫莹莹的大葡萄，看起来让人垂涎欲滴。

啊！美丽的秋天来了，它给大地披上了金装，带来了丰收的喜悦。`;

const SPRING_FLOWERS = `“一年之计在于春”，春天到了，万物复苏了！小草从地下探出头来了;柳树抽出了嫩绿的新芽;桃花也开了，粉红色的花瓣在春风中摇曳着，散发出淡淡的花香。

公园里，各种各样的鲜花竞相开放，五颜六色，美丽极了！你看那迎春花，金黄金黄的，像一个个小喇叭似的，吹奏着春天的赞歌;还有那些不知名的小野花，它们虽然没有牡丹那么高贵典雅，也没有玫瑰那样艳丽夺目，但是它们的生命力却非常顽强，不管风吹雨打，还是烈日炎炎，都依然挺立在那里，默默地装点着美丽的春天。

这些可爱的花儿们，你们知道吗？我们人类离不开你们呀！如果没有你们的存在，我们的世界将会变得多么单调乏味啊！所以我们要保护环境，爱护大自然，让地球上所有的生物都能和谐共处。`;

const CAMPING = `在一个阳光明媚的日子里，我们学校组织了一次野外露营活动。那天早上，同学们怀着激动的心情早早就到了学校集合地点。大家排好队后，便坐上了大巴车向目的地出发了。经过一个多小时的车程，终于到达了目的地——一处风景优美的山谷中。这里空气清新，环境幽静，是个非常适合露营的地方。

一下车，我们就迫不及待地开始了搭帐篷的工作。虽然大家都不是第一次参加这样的活动，但每个人都表现得十分认真。不一会儿，一个个漂亮的帐篷就搭建好了。接着，老师又教给我们如何生火做饭的方法。在大家的共同努力下，一顿丰盛的午餐很快就被准备好了。吃完饭后，我们在老师的带领下开始进行各种户外拓展游戏。这些游戏不仅锻炼了我们的团队协作能力，还让我们学会了相互帮助与关爱他人。

傍晚时分，夕阳西下，天空中的云彩被染成了金黄色。此时此刻，整个世界都被笼罩在了这美丽的霞光之中。同学们纷纷拿出手机拍照留念，记录下了这次难忘的经历。夜幕降临，篝火熊熊燃烧起来。大家围坐在篝火旁，一边吃着美味的食物，一边谈论着一天的所见所闻。欢声笑语回荡在这片宁静的山谷之中，久久不散去。

这一天过得真是充实而快乐！这次露营活动让我深刻体会到了集体的力量以及团结互助的重要性。希望以后还能有机会参加这样有趣的活动。`;

/* ------------------------------- 模板常量 ------------------------------- */

const CORRECT_INTRO =
  '请你根据输入的作文内容，对词句、段落、错别字等进行点评，并给出整体评价。';
const SCORE_INTRO =
  '请你根据输入的作文内容进行评分，并从立意、结构、表达等维度给出评分的理由。';
const EXPLAIN_INTRO =
  '请你根据输入的优秀范文，从好词好句、写作思路、写作技法维度进行赏析讲解。';
const POLISH_INTRO = '请你根据输入的作文内容进行全文润色。';
const STRUCTURE_INTRO = '请你根据输入的作文内容，给出结构调整建议。';

const CORRECT_EMPTY = withTitleAndBody(CORRECT_INTRO);
const CORRECT_BEIJING = withTitleAndBody(
  CORRECT_INTRO,
  '北京的秋天',
  BEIJING_AUTUMN,
);

const SCORE_EMPTY = withTitleAndBody(SCORE_INTRO);
const SCORE_RABBIT = withTitleAndBody(SCORE_INTRO, '《龟兔赛跑》新编');

const EXPLAIN_EMPTY = withTitleAndBody(EXPLAIN_INTRO);
const EXPLAIN_AUTUMN = withTitleAndBody(
  EXPLAIN_INTRO,
  '北京的秋',
  AUTUMN_BEIJING,
);
const EXPLAIN_SPRING = withTitleAndBody(
  EXPLAIN_INTRO,
  '春天的花儿',
  SPRING_FLOWERS,
);
const EXPLAIN_CAMPING = withTitleAndBody(EXPLAIN_INTRO, '记一次露营', CAMPING);

const POLISH_EMPTY = withTitleAndBody(POLISH_INTRO);

const STRUCTURE_EMPTY = withTitleAndBody(STRUCTURE_INTRO);
const STRUCTURE_MUSIC_BOX = withTitleAndBody(STRUCTURE_INTRO, '我的音乐盒');

const MODEL_ESSAY = [
  { type: 'text' as const, value: '我是一名' },
  {
    type: 'content' as const,
    key: 'grade',
    props: { placeholder: '输入年级，例如：初中一年级' },
  },
  { type: 'text' as const, value: '的学生。帮我写一篇' },
  {
    type: 'content' as const,
    key: 'words',
    props: { placeholder: '输入字数，例如：800字' },
  },
  { type: 'text' as const, value: '的' },
  {
    type: 'content' as const,
    key: 'style',
    props: { placeholder: '输入文体，例如：记叙文' },
  },
  { type: 'text' as const, value: '，题目是：' },
  {
    type: 'content' as const,
    key: 'topic',
    props: { placeholder: '填写作文题目，例如北京的秋天' },
  },
];

const MATERIAL = [
  { type: 'text' as const, value: '我想要' },
  {
    type: 'content' as const,
    key: 'topic',
    props: { placeholder: '输入主题，例如：自然风光相关的作文素材' },
  },
  { type: 'text' as const, value: '，具体要求有' },
  {
    type: 'content' as const,
    key: 'requirement',
    props: { placeholder: '输入具体要求，例如记叙文素材、名人名言等' },
  },
];

const PHRASES = [
  { type: 'text' as const, value: '我想要' },
  {
    type: 'content' as const,
    key: 'topic',
    props: { placeholder: '输入主题，例如：自然风光相关的好词好句' },
  },
  { type: 'text' as const, value: '，具体要求有' },
  {
    type: 'content' as const,
    key: 'requirement',
    props: {
      placeholder: '输入具体要求，例如记叙文素材、名人名言；数量，例如：3条等',
    },
  },
];

/** 作文助手：语文作文批改/评分/范文/素材等 8 条快捷指令（4 条带示例）。 */
export const ESSAY_ASSISTANT: AssistantPreset = {
  key: 'essay',
  title: '作文助手',
  icon: <EditOutlined />,
  welcomeTitle: '你好，我是你的语文作文助手',
  welcome:
    '我能针对您输入的作文进行批改、润色、纠错等服务，并且支持作文文本、作文图片两种输入方式，为了更好帮助您，我们需要一些必要信息，您可以点击下列示例体验或选择右侧指令输入',
  prompts: [
    {
      key: 'correct',
      label: '作文批改',
      icon: <FileTextOutlined />,
      slots: CORRECT_EMPTY,
      examples: [
        { key: 'beijing', label: '北京的秋天', slots: CORRECT_BEIJING },
      ],
    },
    {
      key: 'score',
      label: '作文评分',
      icon: <CheckCircleOutlined />,
      slots: SCORE_EMPTY,
      examples: [{ key: 'rabbit', label: '龟兔赛跑新编', slots: SCORE_RABBIT }],
    },
    {
      key: 'model',
      label: '范文生成',
      icon: <EditOutlined />,
      slots: MODEL_ESSAY,
    },
    {
      key: 'explain',
      label: '范文讲解',
      icon: <ReadOutlined />,
      slots: EXPLAIN_EMPTY,
      examples: [
        { key: 'autumn', label: '北京的秋', slots: EXPLAIN_AUTUMN },
        { key: 'spring', label: '春天的花儿', slots: EXPLAIN_SPRING },
        { key: 'camping', label: '记一次露营', slots: EXPLAIN_CAMPING },
      ],
    },
    {
      key: 'polish',
      label: '作文润色',
      icon: <HighlightOutlined />,
      slots: POLISH_EMPTY,
    },
    {
      key: 'material',
      label: '作文素材',
      icon: <BulbOutlined />,
      slots: MATERIAL,
    },
    {
      key: 'phrases',
      label: '好词好句生成',
      icon: <BookOutlined />,
      slots: PHRASES,
    },
    {
      key: 'structure',
      label: '结构调整建议',
      icon: <ApartmentOutlined />,
      slots: STRUCTURE_EMPTY,
      examples: [
        { key: 'music-box', label: '我的音乐盒', slots: STRUCTURE_MUSIC_BOX },
      ],
    },
  ],
};

/** 全部已注册的快捷助手（侧栏入口按此顺序生成）。 */
export const ASSISTANT_PRESETS: AssistantPreset[] = [ESSAY_ASSISTANT];
