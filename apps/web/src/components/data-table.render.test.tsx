import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, type Column, type PageMeta } from './data-table';
import { DateInput } from './form-fields';

/**
 * These mount the real components.
 *
 * The typechecker proves the props line up; it cannot prove that the calendar
 * renders, that a page button calls back with the right number, or that the
 * "showing x–y of N" arithmetic is right at a page boundary — and those are
 * exactly the things a user notices first.
 */

interface Row {
  id: string;
  name: string;
  count: number;
}

const rows: Row[] = [
  { id: 'a', name: 'Alpha Industries', count: 3 },
  { id: 'b', name: 'Beta Textiles', count: 0 },
];

const columns: Array<Column<Row>> = [
  { key: 'name', header: 'Name', sortable: true, cell: (r) => r.name },
  { key: 'count', header: 'Cases', cell: (r) => r.count },
];

const meta = (over: Partial<PageMeta> = {}): PageMeta => ({
  page: 3,
  pageSize: 25,
  total: 213,
  totalPages: 9,
  hasPrev: true,
  hasNext: true,
  ...over,
});

describe('DataTable', () => {
  it('renders the rows it is given', () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} />);
    expect(screen.getByText('Alpha Industries')).toBeInTheDocument();
    expect(screen.getByText('Beta Textiles')).toBeInTheDocument();
  });

  it('shows the empty state instead of rows when there are none', () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        empty={<p>No clients yet</p>}
      />,
    );
    expect(screen.getByText('No clients yet')).toBeInTheDocument();
  });

  it('counts the range correctly on a middle page', () => {
    render(
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} meta={meta()} noun="clients" />,
    );
    // Page 3 of 25 per page = rows 51 through 75.
    expect(screen.getByText('51')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
    expect(screen.getByText('213')).toBeInTheDocument();
  });

  it('does not run past the total on the last page', () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        meta={meta({ page: 9, hasNext: false })}
        noun="clients"
      />,
    );
    // 9 * 25 = 225, but there are only 213 rows, so the range must stop at
    // 213 — which then legitimately appears twice: as the range end and as
    // the total.
    expect(screen.getByText('201')).toBeInTheDocument();
    expect(screen.getAllByText('213')).toHaveLength(2);
    expect(screen.queryByText('225')).not.toBeInTheDocument();
  });

  it('asks for the page the user clicked', async () => {
    const onPageChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        meta={meta()}
        onPageChange={onPageChange}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'pagination' });
    await userEvent.click(within(nav).getByRole('button', { name: '4' }));
    expect(onPageChange).toHaveBeenCalledWith(4);

    await userEvent.click(within(nav).getByRole('button', { name: /previous/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('disables the edges of the pagination rather than hiding them', () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        meta={meta({ page: 1, hasPrev: false })}
        onPageChange={vi.fn()}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'pagination' });
    expect(within(nav).getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(within(nav).getByRole('button', { name: /next/i })).not.toBeDisabled();
  });

  it('flips direction when the active sort column is clicked again', async () => {
    const onSortChange = vi.fn();
    const { rerender } = render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort="name"
        dir="desc"
        onSortChange={onSortChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /name/i }));
    expect(onSortChange).toHaveBeenLastCalledWith('name', 'asc');

    rerender(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort="count"
        dir="asc"
        onSortChange={onSortChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /name/i }));
    expect(onSortChange).toHaveBeenLastCalledWith('name', 'desc');
  });

  it('makes a clickable row reachable by keyboard', async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} onRowClick={onRowClick} />,
    );
    const row = screen.getAllByRole('link')[0]!;
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});

describe('DateInput', () => {
  it('shows an ISO value in DD/MM/YYYY', () => {
    render(<DateInput value="2024-03-15" onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveValue('15/03/2024');
  });

  it('reports a typed date as ISO', async () => {
    const onChange = vi.fn();
    render(<DateInput value="" onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox'), '15/03/2024');
    expect(onChange).toHaveBeenLastCalledWith('2024-03-15');
  });

  it('opens a calendar and reports the day that was picked', async () => {
    const onChange = vi.fn();
    render(<DateInput value="2024-03-15" onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /open calendar/i }));
    expect(screen.getByRole('grid')).toBeInTheDocument();

    // react-day-picker gives each day button role="gridcell", not "button".
    await userEvent.click(screen.getByRole('gridcell', { name: '20' }));
    expect(onChange).toHaveBeenLastCalledWith('2024-03-20');
  });

  it('clears the value from the calendar footer', async () => {
    const onChange = vi.fn();
    render(<DateInput value="2024-03-15" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /open calendar/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
