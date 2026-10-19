import { describe, expect, it } from 'vitest';
import { generatePlainText, resumeFullName } from './plain-text';

const sections = [
  {
    type: 'personal_info',
    title: '个人信息',
    visible: true,
    content: {
      fullName: '张三',
      jobTitle: '后端工程师',
      email: 'zhangsan@example.com',
      phone: '13800000000',
      location: '上海',
    },
  },
  {
    type: 'work_experience',
    title: '工作经历',
    visible: true,
    content: {
      items: [
        {
          company: 'ACME',
          position: '工程师',
          startDate: '2020-01',
          endDate: null,
          current: true,
          description: '做订单系统',
          highlights: ['QPS 提升 3 倍'],
          technologies: ['Go'],
        },
      ],
    },
  },
  {
    type: 'skills',
    title: '技能',
    visible: true,
    content: { categories: [{ name: '语言', skills: ['Go', 'TS'] }] },
  },
  {
    type: 'summary',
    title: '隐藏段落',
    visible: false,
    content: { text: '这段不应该出现在纯文本里' },
  },
  {
    type: 'github',
    title: 'GitHub',
    visible: true,
    content: {
      items: [
        {
          name: 'jade',
          repoUrl: 'https://github.com/example/jade',
          stars: 12,
          language: 'TypeScript',
          description: 'resume builder',
        },
      ],
    },
  },
  {
    // PostgreSQL 下 content 可能是 JSON 字符串，也要能解析
    type: 'custom',
    title: '自定义',
    visible: true,
    content: JSON.stringify({
      items: [{ title: '开源贡献', subtitle: '社区', date: '2024', description: '维护组件库' }],
    }),
  },
];

describe('generatePlainText', () => {
  it('把结构化简历压成模型可读的纯文本', () => {
    const text = generatePlainText({ sections });

    expect(text).toContain('张三');
    expect(text).toContain('后端工程师');
    expect(text).toContain('== 工作经历 ==');
    expect(text).toContain('- 工程师 at ACME');
    expect(text).toContain('2020-01 - Present');
    expect(text).toContain('QPS 提升 3 倍');
    expect(text).toContain('- 语言: Go, TS');
    expect(text).toContain('开源贡献');
    expect(text).toContain('维护组件库');
  });

  it('跳过隐藏段落与二维码段落', () => {
    const text = generatePlainText({
      sections: [
        ...sections,
        { type: 'qr_codes', title: '二维码', visible: true, content: { items: [{ label: 'x', url: 'https://x.test' }] } },
      ],
    });

    expect(text).not.toContain('这段不应该出现在纯文本里');
    expect(text).not.toContain('== 二维码 ==');
  });

  it('GitHub 段落带出仓库名与语言', () => {
    const text = generatePlainText({ sections });
    expect(text).toContain('jade');
    expect(text).toContain('TypeScript | ★12');
    expect(text).toContain('https://github.com/example/jade');
  });

  it('没有可见内容时返回空字符串', () => {
    expect(generatePlainText({ sections: [] })).toBe('');
    expect(
      generatePlainText({
        sections: [{ type: 'summary', title: '简介', visible: false, content: { text: 'hidden' } }],
      }),
    ).toBe('');
  });
});

describe('resumeFullName', () => {
  it('从 personal_info 取姓名', () => {
    expect(resumeFullName(sections)).toBe('张三');
  });

  it('没有个人信息时返回空字符串', () => {
    expect(resumeFullName([])).toBe('');
  });
});
