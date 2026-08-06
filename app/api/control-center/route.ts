import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  addProofData,
  addSharvaTaskData,
  archiveSharvaListData,
  createSharvaListData,
  updateSharvaTaskStatusData
} from '../../../src/domain/sharvaTaskService';
import { editTaskDetailsData } from '../../../src/domain/taskDetailsService';
import { getControlCenterState } from '../../../src/domain/controlCenterService';
import type { SharvaTaskWidgetOutput } from '../../../src/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const taskStatus = z.enum(['pending', 'in_progress', 'blocked', 'done', 'verified', 'dropped']);
const priority = z.enum(['P0', 'P1', 'P2', 'P3']);

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_list'),
    title: z.string().trim().min(1).max(160),
    project: z.string().trim().max(120).optional()
  }),
  z.object({
    action: z.literal('add_task'),
    list_id: z.string().min(1),
    title: z.string().trim().min(1).max(240),
    notes: z.string().max(4000).optional(),
    priority: priority.optional()
  }),
  z.object({
    action: z.literal('set_status'),
    list_id: z.string().min(1),
    item_id: z.string().min(1),
    status: taskStatus
  }),
  z.object({
    action: z.literal('edit_task'),
    list_id: z.string().min(1),
    item_id: z.string().min(1),
    title: z.string().trim().min(1).max(240).optional(),
    notes: z.string().max(4000).optional(),
    next_action: z.string().max(2000).optional(),
    pablo_instruction: z.string().max(2000).optional(),
    priority: priority.optional(),
    status: taskStatus.optional()
  }),
  z.object({
    action: z.literal('add_proof'),
    list_id: z.string().min(1),
    item_id: z.string().min(1),
    proof: z.string().trim().min(1).max(4000)
  }),
  z.object({
    action: z.literal('archive_list'),
    list_id: z.string().min(1),
    reason: z.string().max(1000).optional()
  })
]);

function noStore<T>(payload: T, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' }
  });
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const listId = request.nextUrl.searchParams.get('list_id') || undefined;
  return noStore(await getControlCenterState(listId));
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return noStore({ error: 'Cross-origin mutation rejected.' }, 403);
  }

  try {
    const input = actionSchema.parse(await request.json());
    let mutation: SharvaTaskWidgetOutput;
    let focusListId: string | undefined;

    switch (input.action) {
      case 'create_list':
        mutation = await createSharvaListData({ title: input.title, project: input.project });
        focusListId = mutation.list?.list_id;
        break;
      case 'add_task':
        mutation = await addSharvaTaskData({
          list_id_or_query: input.list_id,
          title: input.title,
          notes: input.notes,
          priority: input.priority
        });
        focusListId = input.list_id;
        break;
      case 'set_status':
        mutation = await updateSharvaTaskStatusData({
          list_id_or_query: input.list_id,
          item_id_or_title: input.item_id,
          status: input.status
        });
        focusListId = input.list_id;
        break;
      case 'edit_task':
        mutation = await editTaskDetailsData({
          list_id_or_query: input.list_id,
          item_id_or_title: input.item_id,
          title: input.title,
          notes: input.notes,
          next_action: input.next_action,
          pablo_instruction: input.pablo_instruction,
          priority: input.priority,
          status: input.status
        });
        focusListId = input.list_id;
        break;
      case 'add_proof':
        mutation = await addProofData({
          list_id_or_query: input.list_id,
          item_id_or_title: input.item_id,
          proof: input.proof
        });
        focusListId = input.list_id;
        break;
      case 'archive_list':
        mutation = await archiveSharvaListData({
          list_id_or_query: input.list_id,
          reason: input.reason
        });
        focusListId = mutation.list?.list_id;
        break;
    }

    const state = await getControlCenterState(focusListId);
    return noStore(
      { mutation, state },
      mutation.success === false ? 400 : 200
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return noStore({ error: 'Invalid control-center request.', issues: error.issues }, 400);
    }
    const message = error instanceof Error ? error.message : 'Control-center operation failed.';
    return noStore({ error: message }, 500);
  }
}
