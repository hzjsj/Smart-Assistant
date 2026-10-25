import { describe, expect, it } from 'vitest';
import type { QietiPage, QuestionInfo, QuestionRect } from '../data';
import {
  isTemporaryImageUrl,
  mergeCrossPageFragments,
  persistMergedImage,
  reindexQuestions,
  unionRect,
  unmergeQuestion,
} from './questionUtils';

const emptyInfo: QuestionInfo = {
  figures: [],
  stemText: '',
  optionTexts: [],
  subquestionTexts: [],
  fullText: '',
};

function makeInfo(partial: Partial<QuestionInfo>): QuestionInfo {
  return { ...emptyInfo, ...partial };
}

function rect(pageId: string, y: number): QuestionRect {
  return { x: 90, y, w: 1000, h: 120, pageId };
}

function question(
  id: string,
  fields: {
    type: string;
    stemText?: string;
    optionTexts?: string[];
    subImages?: string[];
    mergedImage?: string;
    y?: number;
    pageId?: string;
  },
): ReturnType<typeof makeQuestion> {
  return makeQuestion({
    id,
    type: fields.type,
    rects: [rect(fields.pageId ?? '', fields.y ?? 100)],
    subImages: fields.subImages ?? [],
    mergedImage: fields.mergedImage ?? '',
    info: makeInfo({
      stemText: fields.stemText ?? '',
      optionTexts: fields.optionTexts ?? [],
    }),
  });
}

function makeQuestion(fields: {
  id: string;
  type: string;
  rects: QuestionRect[];
  subImages: string[];
  mergedImage: string;
  info: QuestionInfo;
}) {
  return {
    id: fields.id,
    no: 0,
    type: fields.type,
    rect: fields.rects[0],
    rects: fields.rects,
    subImages: fields.subImages,
    mergedImage: fields.mergedImage,
    info: fields.info,
  };
}

function makePage(id: string, questions: QietiPage['questions']): QietiPage {
  return {
    id,
    name: `第 ${id} 页`,
    imageUrl: `blob:${id}`,
    uploadedImageUrl: `https://kdsa.oss-cn-shanghai.aliyuncs.com/qieti/${id}.png`,
    width: 1200,
    height: 1600,
    questions,
  };
}

/**
 * 2025 全国Ⅰ卷实测数据的简化夹具：
 * 第 6 题跨第 1·2 页（下页首条为无题干纯图碎片）、
 * 第 10 题跨第 2·3 页（下页首条为无题干 C/D 选项碎片）、
 * 第 15/16 题分属第 3·4 页（不跨页，不应误合）。
 */
function buildExamPages(): QietiPage[] {
  const p1 = makePage('p1', [
    question('q5', {
      type: '单选题',
      stemText: '5. 设 f(x) 是定义在 R 上且周期为 2 的偶函数…（）',
      optionTexts: ['A. -1/2', 'B. -1/4', 'C. 1/4', 'D. 1/2'],
      y: 1200,
    }),
    question('q6-stem', {
      type: '简答题',
      stemText:
        '6. 帆船比赛中，运动员可借助风力计测定风速的大小和方向…单位（m/s），',
      y: 1340,
    }),
  ]);
  const p2 = makePage('p2', [
    question('q6-frag', {
      type: '单选题',
      subImages: [
        'http://duguang-mld.oss-accelerate.aliyuncs.com/ocr_edu/f6.png?Expires=1&Signature=x',
      ],
      y: 111,
      pageId: 'p2',
    }),
    question('q7', {
      type: '单选题',
      stemText: '7. 若圆 x^2+(y+2)^2=r^2 上到直线…则 r 的取值范围是（ ）',
      optionTexts: ['A. (0,1)', 'B. (1,3)', 'C. (3,+∞)', 'D. (0,+∞)'],
      y: 760,
      pageId: 'p2',
    }),
    question('q10-stem', {
      type: '单选题',
      stemText: '10. 设抛物线 C: y^2=6x 的焦点为 F…则（）',
      optionTexts: ['A. |AD|=|AF|', 'B. |AE|=|AB|'],
      y: 1360,
      pageId: 'p2',
    }),
  ]);
  const p3 = makePage('p3', [
    question('q10-frag', {
      type: '单选题',
      optionTexts: ['C. |AB|≥6', 'D. |AE|·|BE|≥18'],
      y: 91,
      pageId: 'p3',
    }),
    question('q11', {
      type: '单选题',
      stemText: '11. 已知△ABC 的面积为 1/4…则（）',
      optionTexts: ['A. …', 'B. …', 'C. …', 'D. …'],
      y: 150,
      pageId: 'p3',
    }),
    question('q15', {
      type: '单选题',
      stemText:
        '15. 为研究某疾病与超声波检查结果的关系…分析超声波检查结果是否与患该疾病有关。',
      y: 690,
      pageId: 'p3',
    }),
  ]);
  const p4 = makePage('p4', [
    question('q16', {
      type: '单选题',
      stemText: '16. 设数列 {a_n} 满足 a_1=3…',
      y: 99,
      pageId: 'p4',
    }),
    question('q19', {
      type: '单选题',
      stemText: '设函数 f(x) = 5cosx - cos5x.',
      y: 1198,
      pageId: 'p4',
    }),
  ]);
  return [p1, p2, p3, p4];
}

describe('mergeCrossPageFragments', () => {
  it('按真实卷数据归并两组跨页残片：21 条中的两组各自合一、其余不动', () => {
    const pages = buildExamPages();
    const totalBefore = pages.reduce(
      (sum, page) => sum + page.questions.length,
      0,
    );
    expect(totalBefore).toBe(10);

    reindexQuestions(pages);
    const merged = mergeCrossPageFragments(pages);
    const totalAfter = merged.reduce(
      (sum, page) => sum + page.questions.length,
      0,
    );
    expect(totalAfter).toBe(8);

    // 第 6 题：主题（残干）吸收第 2 页纯图碎片，框跨页、来源可拆
    const p1 = merged[0];
    const q6 = p1.questions.find((item) => item.id === 'q6-stem');
    expect(q6).toBeTruthy();
    expect(q6?.rects).toHaveLength(2);
    expect(q6?.rects[1].pageId).toBe('p2');
    expect(q6?.sources).toHaveLength(2);
    expect(q6?.info.stemText).toContain('6. 帆船比赛中');
    expect(q6?.subImages).toHaveLength(1);
    // 题型优选：续排碎片识别为选择题，覆盖残干的"简答题"误判
    expect(q6?.type).toBe('单选题');

    // 第 10 题：残题吸收 C/D 选项碎片，四选项文本齐全
    const p2 = merged[1];
    const q10 = p2.questions.find((item) => item.id === 'q10-stem');
    expect(q10?.info.optionTexts).toEqual([
      'A. |AD|=|AF|',
      'B. |AE|=|AB|',
      'C. |AB|≥6',
      'D. |AE|·|BE|≥18',
    ]);
    expect(q10?.rects[1].pageId).toBe('p3');

    // 第 15/16 题不误合（下页首条有题号）
    expect(merged[2].questions.some((item) => item.id === 'q15')).toBe(true);
    expect(merged[3].questions.some((item) => item.id === 'q16')).toBe(true);
  });

  it('规则 b：下页首条题干无题号且前页末题以续接标点收尾时并入', () => {
    const pages = [
      makePage('p1', [
        question('q6-stem', {
          type: '简答题',
          stemText: '6. 帆船比赛中…单位（m/s），',
          y: 1340,
        }),
      ]),
      makePage('p2', [
        question('q6-tail', {
          type: '单选题',
          stemText: '则真风为（ ）',
          optionTexts: ['A. 轻风', 'B. 微风', 'C. 和风', 'D. 劲风'],
          y: 111,
          pageId: 'p2',
        }),
      ]),
    ];
    reindexQuestions(pages);
    const merged = mergeCrossPageFragments(pages);
    expect(merged[0].questions).toHaveLength(1);
    expect(merged[0].questions[0].id).toBe('q6-stem');
    expect(merged[0].questions[0].rects[1].pageId).toBe('p2');
    expect(merged[1].questions).toHaveLength(0);
  });

  it('前页末题完整（题号开头且选项齐全）时不误合', () => {
    const pages = [
      makePage('p1', [
        question('q5', {
          type: '单选题',
          stemText: '5. 设 f(x) 是定义在 R 上…（）',
          optionTexts: ['A. -1/2', 'B. -1/4', 'C. 1/4', 'D. 1/2'],
        }),
      ]),
      makePage('p2', [
        question('q7', {
          type: '单选题',
          stemText: '7. 若圆…则 r 的取值范围是（ ）',
          optionTexts: ['A. (0,1)', 'B. (1,3)', 'C. (3,+∞)', 'D. (0,+∞)'],
          pageId: 'p2',
        }),
      ]),
    ];
    reindexQuestions(pages);
    const merged = mergeCrossPageFragments(pages);
    expect(merged[0].questions).toHaveLength(1);
    expect(merged[1].questions).toHaveLength(1);
  });

  it('解除合并可完整还原跨页合并', () => {
    const pages = buildExamPages();
    reindexQuestions(pages);
    const merged = mergeCrossPageFragments(pages);
    const restored = unmergeQuestion(merged, 'q6-stem');
    const total = restored.reduce(
      (sum, page) => sum + page.questions.length,
      0,
    );
    // 仅还原第 6 题那一对（第 10 题保持合并态）：8 + 1 = 9
    expect(total).toBe(9);
    expect(restored[0].questions.some((item) => item.id === 'q6-stem')).toBe(
      true,
    );
    expect(restored[1].questions.some((item) => item.id === 'q6-frag')).toBe(
      true,
    );
  });
});

describe('persistMergedImage', () => {
  const pageUrl = 'https://kdsa.oss-cn-shanghai.aliyuncs.com/qieti/p1.png';
  const tempUrl =
    'http://duguang-mld.oss-accelerate.aliyuncs.com/ocr_edu/x.png?OSSAccessKeyId=LTAI&Expires=1793538336&Signature=abc';

  it('临时签名链替换为自有 OSS 页图裁剪链', () => {
    expect(
      persistMergedImage(tempUrl, pageUrl, [
        { x: 90.6, y: 111.2, w: 862, h: 646 },
      ]),
    ).toBe(`${pageUrl}?x-oss-process=image/crop,w_862,h_646,x_90,y_111`);
  });

  it('自有 OSS 链接原样保留', () => {
    const own = `${pageUrl}?x-oss-process=image/crop,w_100,h_50,x_0,y_0`;
    expect(persistMergedImage(own, pageUrl, [])).toBe(own);
  });

  it('isTemporaryImageUrl 识别签名参数', () => {
    expect(isTemporaryImageUrl(tempUrl)).toBe(true);
    expect(isTemporaryImageUrl(pageUrl)).toBe(false);
    expect(isTemporaryImageUrl(undefined)).toBe(false);
  });
});

describe('unionRect', () => {
  it('计算包围盒', () => {
    expect(
      unionRect([
        { x: 10, y: 20, w: 30, h: 40 },
        { x: 100, y: 5, w: 50, h: 60 },
      ]),
    ).toEqual({ x: 10, y: 5, w: 140, h: 60 });
  });

  it('空数组返回 null', () => {
    expect(unionRect([])).toBeNull();
  });
});
