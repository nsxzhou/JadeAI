import type {
  CertificationsContent,
  CustomContent,
  EducationContent,
  GitHubContent,
  LanguagesContent,
  PersonalInfoContent,
  ProjectsContent,
  SkillsContent,
  SummaryContent,
  WorkExperienceContent,
} from '@/types/resume';

/**
 * 生成纯文本只需要这几个字段。
 *
 * 不直接用 ResumeWithSections 是因为它绑定在 repository 的返回类型上；
 * 面试官视角从简历库读出的简历、导出接口读出的简历都应当能喂进来。
 */
export interface ResumeSectionTextSource {
  type: string;
  title: string;
  visible: boolean;
  content: unknown;
}

function safe(val: unknown): string {
  return val != null ? String(val) : '';
}

/** PostgreSQL 的 JSON 列读出来可能是字符串；两种形态都接受。 */
function parseContent(content: unknown): unknown {
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch {
      return {};
    }
  }
  return content ?? {};
}

/** 从 personal_info 里取姓名，供候选人还没起名时兜底。 */
export function resumeFullName(sections: ReadonlyArray<ResumeSectionTextSource>): string {
  const section = sections.find((item) => item.type === 'personal_info');
  if (!section) return '';
  const info = parseContent(section.content) as Partial<PersonalInfoContent>;
  return typeof info.fullName === 'string' ? info.fullName.trim() : '';
}

/**
 * 简历正文 → 纯文本。
 *
 * 导出 txt 和面试官视角「从简历库选择简历」共用这一份实现：
 * 两处都是把结构化 sections 压成模型可读的文本，不能各写一套。
 */
export function generatePlainText(resume: { sections: ReadonlyArray<ResumeSectionTextSource> }): string {
  const lines: string[] = [];

  for (const section of resume.sections) {
    if (!section.visible) continue;
    if (section.type === 'qr_codes') continue;

    switch (section.type) {
      case 'personal_info': {
        const info = parseContent(section.content) as PersonalInfoContent;
        if (info.fullName) lines.push(info.fullName);
        if (info.jobTitle) lines.push(info.jobTitle);
        const infoParts: string[] = [];
        if (info.age) infoParts.push(info.age);
        if (info.gender) infoParts.push(info.gender);
        if (info.politicalStatus) infoParts.push(info.politicalStatus);
        if (info.ethnicity) infoParts.push(info.ethnicity);
        if (info.hometown) infoParts.push(info.hometown);
        if (info.maritalStatus) infoParts.push(info.maritalStatus);
        if (info.yearsOfExperience) infoParts.push(info.yearsOfExperience);
        if (info.educationLevel) infoParts.push(info.educationLevel);
        if (infoParts.length > 0) lines.push(infoParts.join(' | '));
        const contactParts: string[] = [];
        if (info.email) contactParts.push(info.email);
        if (info.phone) contactParts.push(info.phone);
        if (info.wechat) contactParts.push(info.wechat);
        if (info.location) contactParts.push(info.location);
        if (contactParts.length > 0) lines.push(contactParts.join(' | '));
        if (info.website) lines.push(info.website);
        lines.push('');
        break;
      }
      case 'summary': {
        const summary = parseContent(section.content) as SummaryContent;
        lines.push('== ' + section.title + ' ==');
        if (summary.text) lines.push(summary.text);
        lines.push('');
        break;
      }
      case 'work_experience': {
        const work = parseContent(section.content) as WorkExperienceContent;
        lines.push('== ' + section.title + ' ==');
        for (const item of work.items || []) {
          lines.push('- ' + safe(item.position) + ' at ' + safe(item.company));
          const dateRange = item.current
            ? safe(item.startDate) + ' - Present'
            : safe(item.startDate) + ' - ' + safe(item.endDate);
          lines.push('  ' + dateRange + (item.location ? ' | ' + item.location : ''));
          if (item.description) lines.push('  ' + item.description);
          for (const h of item.highlights || []) {
            if (h) lines.push('  * ' + h);
          }
        }
        lines.push('');
        break;
      }
      case 'education': {
        const edu = parseContent(section.content) as EducationContent;
        lines.push('== ' + section.title + ' ==');
        for (const item of edu.items || []) {
          lines.push('- ' + safe(item.degree) + ' in ' + safe(item.field) + ', ' + safe(item.institution));
          lines.push('  ' + safe(item.startDate) + ' - ' + safe(item.endDate) + (item.location ? ' | ' + item.location : ''));
          if (item.gpa) lines.push('  GPA: ' + item.gpa);
          for (const h of item.highlights || []) {
            if (h) lines.push('  * ' + h);
          }
        }
        lines.push('');
        break;
      }
      case 'skills': {
        const skills = parseContent(section.content) as SkillsContent;
        lines.push('== ' + section.title + ' ==');
        for (const cat of skills.categories || []) {
          lines.push('- ' + safe(cat.name) + ': ' + (cat.skills || []).join(', '));
        }
        lines.push('');
        break;
      }
      case 'projects': {
        const projects = parseContent(section.content) as ProjectsContent;
        lines.push('== ' + section.title + ' ==');
        for (const item of projects.items || []) {
          lines.push('- ' + safe(item.name) + (item.url ? ' (' + item.url + ')' : ''));
          if (item.startDate) {
            lines.push('  ' + item.startDate + (item.endDate ? ' - ' + item.endDate : ''));
          }
          if (item.description) lines.push('  ' + item.description);
          if (item.technologies?.length) lines.push('  Technologies: ' + item.technologies.join(', '));
          for (const h of item.highlights || []) {
            if (h) lines.push('  * ' + h);
          }
        }
        lines.push('');
        break;
      }
      case 'certifications': {
        const certs = parseContent(section.content) as CertificationsContent;
        lines.push('== ' + section.title + ' ==');
        for (const item of certs.items || []) {
          lines.push(
            '- ' +
              safe(item.name) +
              (item.issuer ? ', ' + safe(item.issuer) : '') +
              (item.date ? ' (' + safe(item.date) + ')' : ''),
          );
        }
        lines.push('');
        break;
      }
      case 'languages': {
        const langs = parseContent(section.content) as LanguagesContent;
        lines.push('== ' + section.title + ' ==');
        for (const item of langs.items || []) {
          lines.push('- ' + safe(item.language) + ': ' + safe(item.proficiency));
        }
        lines.push('');
        break;
      }
      case 'github': {
        const github = parseContent(section.content) as GitHubContent;
        lines.push('== ' + section.title + ' ==');
        for (const item of github.items || []) {
          const meta = [item.language, item.stars ? '★' + item.stars : ''].filter(Boolean).join(' | ');
          lines.push(
            '- ' +
              safe(item.name) +
              (meta ? ' (' + meta + ')' : '') +
              (item.repoUrl ? ' ' + item.repoUrl : ''),
          );
          if (item.description) lines.push('  ' + item.description);
        }
        lines.push('');
        break;
      }
      default: {
        const custom = parseContent(section.content) as CustomContent;
        lines.push('== ' + section.title + ' ==');
        for (const item of custom.items || []) {
          lines.push('- ' + safe(item.title) + (item.subtitle ? ' - ' + item.subtitle : ''));
          if (item.date) lines.push('  ' + item.date);
          if (item.description) lines.push('  ' + item.description);
        }
        lines.push('');
        break;
      }
    }
  }

  return lines.join('\n');
}
