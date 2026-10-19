import { describe, expect, it } from 'vitest';
import { familyDimensionKeys, isGoRole, normalizePrimaryStack, normalizeRoleFamily, resolveRoleFamily, staticRoleFamily } from './role-family';

describe('normalizeRoleFamily', () => {
  it('清单命中时原样返回', () => {
    expect(normalizeRoleFamily('frontend')).toBe('frontend');
  });

  it('未知或缺失回落 other', () => {
    expect(normalizeRoleFamily('designer')).toBe('other');
    expect(normalizeRoleFamily(null)).toBe('other');
    expect(normalizeRoleFamily(undefined)).toBe('other');
  });
});

describe('normalizePrimaryStack', () => {
  it('未知或缺失回落 none', () => {
    expect(normalizePrimaryStack('rust')).toBe('none');
    expect(normalizePrimaryStack(undefined)).toBe('none');
    expect(normalizePrimaryStack('go')).toBe('go');
  });
});

describe('staticRoleFamily', () => {
  it('按关键词命中清单里的族', () => {
    expect(staticRoleFamily('后端工程师', '负责微服务与数据库')).toBe('backend');
    expect(staticRoleFamily('Frontend Engineer', 'React and browser performance')).toBe('frontend');
    expect(staticRoleFamily('算法工程师', '推荐系统与模型迭代')).toBe('data_algo');
    expect(staticRoleFamily('SRE', '可观测性与发布')).toBe('qa_infra');
  });

  it('判不出来时回落 other', () => {
    expect(staticRoleFamily('Product Manager', 'roadmap and stakeholders')).toBe('other');
  });

  it('不把 "go onsite" 这类散文误判成后端族', () => {
    expect(staticRoleFamily('Office Assistant', 'willingness to go onsite')).toBe('other');
  });
});

describe('resolveRoleFamily', () => {
  it('显式给定合法 key 时以它为准', () => {
    expect(resolveRoleFamily({
      roleFamilyKey: 'frontend',
      jobTitle: '后端工程师',
      jobDescription: '微服务',
    }).roleFamily).toBe('frontend');
  });

  it('未给 key 时用静态关键词判定', () => {
    expect(resolveRoleFamily({ jobTitle: '后端工程师', jobDescription: 'Go 服务' }).roleFamily).toBe('backend');
  });
});

describe('isGoRole', () => {
  it('只有「后端族 + Go 栈」才是 Go 岗', () => {
    expect(isGoRole('backend', 'go')).toBe(true);
    expect(isGoRole('backend', 'java')).toBe(false);
    expect(isGoRole('frontend', 'go')).toBe(false);
  });
});

describe('familyDimensionKeys', () => {
  it('非 Go 堆栈不得出现 go_fundamentals', () => {
    expect(familyDimensionKeys('backend', 'java')).not.toContain('go_fundamentals');
    expect(familyDimensionKeys('frontend', 'go')).not.toContain('go_fundamentals');
  });

  it('Go 后端出现 go_fundamentals', () => {
    expect(familyDimensionKeys('backend', 'go')).toContain('go_fundamentals');
  });

  it('其他族保留岗位专业能力与项目深挖两个维度', () => {
    expect(familyDimensionKeys('other', 'none')).toEqual(['role_professional', 'project_deep_dive']);
  });
});
