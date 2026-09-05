import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/db';
import Run from '@/lib/models/Run';

/**
 * GET /api/runs/[id]
 *
 * Retrieves a specific scenario run by MongoDB ObjectId.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  try {
    // 1. Establish database connection
    await dbConnect();

    // 2. Resolve route parameters (safe for Next.js 14 & 15)
    const resolvedParams = await Promise.resolve(params);
    const { id } = resolvedParams;

    // Validate MongoDB ObjectId format
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { error: `Invalid run ID format: ${id}` },
        { status: 400 },
      );
    }

    // 3. Query run by ID
    const runDoc = await Run.findById(id).lean();

    if (!runDoc) {
      return NextResponse.json(
        { error: `Run with ID '${id}' not found` },
        { status: 404 },
      );
    }

    // 4. Return document JSON
    return NextResponse.json(runDoc, { status: 200 });
  } catch (error: unknown) {
    console.error('Error fetching run by ID:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json(
      {
        error: 'Failed to retrieve run document',
        details: errorMessage,
      },
      { status: 500 },
    );
  }
}
