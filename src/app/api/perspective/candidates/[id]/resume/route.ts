import { NextRequest, NextResponse } from 'next/server';
import { extractAIConfig, AIConfigError } from '@/lib/ai/provider';
import { parseResumeFile, validateResumeFile } from '@/lib/ai/parse-resume';
import { perspectiveRepository } from '@/lib/db/repositories/perspective.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { requireOwnedCandidate } from '@/lib/perspective/access';
import { generatePlainText, resumeFullName } from '@/lib/resume/plain-text';
import type { ParsedResume } from '@/lib/ai/parse-schema';

/**
 * 把结构化简历压成一段文本，供后续两次 AI 调用当上下文用。
 * 直接塞 JSON 也能work，但纯文本更省 token 且模型更容易读。
 */
function flattenResume(data: ParsedResume): string {
  const parts: string[] = [];
  const p = data.personalInfo;
  if (p) {
    parts.push(`姓名：${p.fullName || ''}｜职位：${p.jobTitle || ''}｜工作年限：${p.yearsOfExperience || ''}｜学历：${p.educationLevel || ''}`);
  }
  if (data.summary) parts.push(`个人简介：${data.summary}`);

  for (const w of data.workExperience ?? []) {
    parts.push(
      `工作经历：${w.company}｜${w.position}｜${w.startDate} - ${w.current ? '至今' : w.endDate || ''}\n${w.description || ''}\n${(w.highlights ?? []).map((h) => `- ${h}`).join('\n')}`,
    );
  }
  for (const e of data.education ?? []) {
    parts.push(`教育经历：${e.institution}｜${e.degree || ''}｜${e.field || ''}｜${e.startDate} - ${e.endDate || ''}`);
  }
  for (const proj of data.projects ?? []) {
    parts.push(
      `项目：${proj.name}\n${proj.description || ''}\n技术栈：${(proj.technologies ?? []).join('、')}\n${(proj.highlights ?? []).map((h) => `- ${h}`).join('\n')}`,
    );
  }
  const skills = (data.skills ?? []).map((s) => `${s.name}：${(s.skills ?? []).join('、')}`);
  if (skills.length) parts.push(`技能：\n${skills.join('\n')}`);

  return parts.join('\n\n');
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = await requireOwnedCandidate(request, id);
    if ('error' in access) return access.error;

    // 从 App 内已有的简历库选一份：不重新解析文件，直接把 sections 压成文本。
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => null);
      const resumeId = typeof body?.resumeId === 'string' ? body.resumeId : '';
      if (!resumeId) {
        return NextResponse.json({ error: 'resumeId required' }, { status: 400 });
      }

      const resume = await resumeRepository.findById(resumeId);
      if (!resume || resume.userId !== access.job.userId) {
        return NextResponse.json({ error: 'Resume not found' }, { status: 404 });
      }

      const resumeText = generatePlainText(resume).trim();
      if (!resumeText) {
        return NextResponse.json({ error: 'Resume is empty' }, { status: 400 });
      }

      const candidate = await perspectiveRepository.updateCandidate(id, {
        resumeData: {
          source: 'library',
          resumeId: resume.id,
          title: resume.title,
          language: resume.language,
          sections: resume.sections,
        },
        resumeText,
        // 简历换了，之前生成的题目就过期了
        questions: null,
        status: 'pending',
        // 候选人还没起过名字时，用简历里的姓名兜底
        ...(access.candidate.name ? {} : { name: resumeFullName(resume.sections) }),
      });

      return NextResponse.json({ candidate, resume: { id: resume.id, title: resume.title } });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    const invalid = validateResumeFile(file);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }

    const aiConfig = extractAIConfig(request);
    const resumeData = await parseResumeFile(file, aiConfig);
    const resumeText = flattenResume(resumeData);

    const candidate = await perspectiveRepository.updateCandidate(id, {
      resumeData,
      resumeText,
      // 简历换了，之前生成的题目就过期了
      questions: null,
      status: 'pending',
      // 候选人还没起过名字时，用简历里的姓名兜底
      ...(access.candidate.name ? {} : { name: resumeData.personalInfo?.fullName || '' }),
    });

    return NextResponse.json({ candidate });
  } catch (error) {
    if (error instanceof AIConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[recruit] resume parse failed:', error);
    return NextResponse.json({ error: 'Failed to parse resume' }, { status: 500 });
  }
}
