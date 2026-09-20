import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Users2 } from 'lucide-react';

import { ENTITY_TYPE, ENTITY_TYPE_LABEL, type EntityType } from '@ifp/shared';
import { clientsApi, type ClientSummary } from '@/api/endpoints';
import { useAuth } from '@/auth/AuthContext';
import { EmptyState, ErrorState, PageBody, PageHeader, formatDate } from '@/components/app-ui';
import { ClearFilters, DataTable, TableToolbar, type Column } from '@/components/data-table';
import { useDebounced, usePagedList } from '@/lib/use-paged-list';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL = '__all__';

export function ClientListPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [entityType, setEntityType] = useState<string>(ALL);
  const debouncedQ = useDebounced(q);

  const list = usePagedList<ClientSummary>({
    load: (params) => clientsApi.list(params),
    filters: {
      q: debouncedQ || undefined,
      entityType: entityType === ALL ? undefined : entityType,
    },
    sort: 'createdAt',
    dir: 'desc',
  });

  const filtered = Boolean(debouncedQ) || entityType !== ALL;

  const columns: Array<Column<ClientSummary>> = [
    {
      key: 'legalName',
      header: 'Legal name',
      sortable: true,
      cell: (c) => (
        <>
          <span className="font-medium">{c.legalName}</span>
          {c.tradeName && (
            <span className="block text-xs text-muted-foreground">{c.tradeName}</span>
          )}
        </>
      ),
    },
    {
      key: 'entityType',
      header: 'Type',
      className: 'text-muted-foreground',
      hideOnMobile: true,
      cell: (c) => ENTITY_TYPE_LABEL[c.entityType as EntityType] ?? c.entityType,
    },
    {
      key: 'pan',
      header: 'PAN',
      className: 'masked text-muted-foreground',
      hideOnMobile: true,
      cell: (c) => c.panMasked ?? '—',
    },
    {
      key: 'gstin',
      header: 'GSTIN',
      className: 'masked text-muted-foreground',
      hideOnMobile: true,
      cell: (c) => c.gstinMasked ?? '—',
    },
    {
      key: 'contact',
      header: 'Contact',
      hideOnMobile: true,
      cell: (c) => (
        <>
          {c.contactPersonName ?? '—'}
          {c.contactPhone && (
            <span className="tabular block text-xs text-muted-foreground">{c.contactPhone}</span>
          )}
        </>
      ),
    },
    {
      key: 'caseCount',
      header: 'Cases',
      sortable: true,
      headClassName: 'text-right',
      className: 'tabular text-right',
      cell: (c) => c.caseCount ?? 0,
    },
    {
      key: 'createdAt',
      header: 'Added',
      sortable: true,
      className: 'whitespace-nowrap text-muted-foreground',
      hideOnMobile: true,
      cell: (c) => formatDate(c.createdAt),
    },
  ];

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="Applicant entities on file for your firm"
        actions={
          can('client:write') && (
            <Button onClick={() => navigate('/clients/new')}>
              <Plus className="mr-2 h-4 w-4" />
              New client
            </Button>
          )
        }
      />

      <PageBody>
        <Card className="overflow-hidden">
          <TableToolbar>
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or contact…"
                className="bg-background pl-8"
                aria-label="Search clients"
              />
            </div>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger className="w-[210px] bg-background">
                <SelectValue placeholder="All entity types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All entity types</SelectItem>
                {ENTITY_TYPE.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ENTITY_TYPE_LABEL[t as EntityType]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ClearFilters
              show={filtered}
              onClear={() => {
                setQ('');
                setEntityType(ALL);
              }}
            />
          </TableToolbar>

          <DataTable
            columns={columns}
            rows={list.rows}
            getRowId={(c) => c.id}
            loading={list.loading}
            onRowClick={(c) => navigate(`/clients/${c.id}`)}
            sort={list.query.sort}
            dir={list.query.dir}
            onSortChange={list.setSort}
            meta={list.meta}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
            noun="clients"
            empty={
              list.error ? (
                <ErrorState title={list.error} description="Try again, or reload the page." />
              ) : filtered ? (
                <EmptyState
                  title="No clients match those filters"
                  description="Clear the search or the entity type to see everything again."
                />
              ) : (
                <EmptyState
                  icon={Users2}
                  title="No clients yet"
                  description="A client is the applicant entity. Create one, then open a case against it."
                  action={
                    can('client:write') && (
                      <Button asChild size="sm">
                        <Link to="/clients/new">
                          <Plus className="mr-2 h-4 w-4" />
                          Add the first client
                        </Link>
                      </Button>
                    )
                  }
                />
              )
            }
          />
        </Card>

        <p className="mt-3 text-xs text-muted-foreground">
          PAN and GSTIN are stored encrypted and shown masked. Opening a client records an access
          entry in the audit log.
        </p>
      </PageBody>
    </>
  );
}
