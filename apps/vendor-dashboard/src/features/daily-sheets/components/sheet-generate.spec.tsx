import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { SheetGenerate } from './sheet-generate';
import { useGenerateSheet, useGenerationStatus } from '../hooks/use-daily-sheets';
import { useAllVans } from '../../vans/hooks/use-vans';
import { renderWithQueryClient } from '../../../test/test-utils';

jest.useFakeTimers();

jest.mock('@water-supply-crm/ui', () => {
  const actual = jest.requireActual('@water-supply-crm/ui');
  return {
    ...actual,
    Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
    SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
    SheetFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

jest.mock('../hooks/use-daily-sheets', () => ({
  useGenerateSheet: jest.fn(),
  useGenerationStatus: jest.fn(),
}));

jest.mock('../../vans/hooks/use-vans', () => ({
  useAllVans: jest.fn(),
}));

const mockUseGenerateSheet = useGenerateSheet as jest.MockedFunction<typeof useGenerateSheet>;
const mockUseGenerationStatus = useGenerationStatus as jest.MockedFunction<typeof useGenerationStatus>;
const mockUseAllVans = useAllVans as jest.MockedFunction<typeof useAllVans>;

describe('SheetGenerate', () => {
  const generate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseGenerateSheet.mockReturnValue({
      mutate: generate,
      isPending: false,
    } as ReturnType<typeof useGenerateSheet>);
    mockUseGenerationStatus.mockImplementation((jobId: string) =>
      ({
        data: jobId
          ? { status: 'completed', result: { sheetIds: ['sheet-1', 'sheet-2'] } }
          : undefined,
        isLoading: false,
      }) as ReturnType<typeof useGenerationStatus>
    );
    mockUseAllVans.mockReturnValue({
      data: {
        data: [
          { id: 'van-1', plateNumber: 'LEA-123', isActive: true },
          { id: 'van-2', plateNumber: 'LEA-456', isActive: true },
        ],
      },
    } as ReturnType<typeof useAllVans>);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('submits selected van ids when generating sheets for a specific fleet subset', async () => {
    renderWithQueryClient(<SheetGenerate open onOpenChange={jest.fn()} />);

    fireEvent.change(screen.getByDisplayValue(new Date().toISOString().split('T')[0]), {
      target: { value: '2026-03-16' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Select Specific' }));
    fireEvent.click(screen.getByLabelText('LEA-123'));
    fireEvent.click(screen.getByRole('button', { name: 'Generate Now' }));

    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith(
        { date: '2026-03-16', vanIds: ['van-1'] },
        expect.any(Object)
      )
    );
  });

  it('closes after a completed generation job and invalidates the sheets query', async () => {
    const onOpenChange = jest.fn();
    const { queryClient } = renderWithQueryClient(<SheetGenerate open onOpenChange={onOpenChange} />);
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    generate.mockImplementation((_payload, options) => {
      options.onSuccess({ jobId: 'job-1' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Generate Now' }));

    await waitFor(() => expect(screen.getByText('Success!')).toBeTruthy());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sheets'] });

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
