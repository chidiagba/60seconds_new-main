"""Audit connection guards run with fake credentials and mocked subprocesses only."""
import contextlib
import io
import os
import runpy
import subprocess
import unittest
from unittest.mock import patch

SCRIPT='scripts/run-readonly-voucher-audit.py'
class AuditConnectionGuards(unittest.TestCase):
    def rejects(self,url,message,output=None):
        env={} if url is None else {'VOUCHER_AUDIT_DATABASE_URL':url}
        with patch.dict(os.environ,env,clear=True), patch('pathlib.Path.is_file',return_value=False), patch('subprocess.run') as run:
            if output is not None:
                run.return_value=subprocess.CompletedProcess([],0,output,'')
            with self.assertRaises(SystemExit) as error:
                runpy.run_path(SCRIPT,run_name='__main__')
            self.assertIn(message,str(error.exception))
            if output is None: run.assert_not_called()
            else:
                self.assertEqual(run.call_count,1)
                args,kwargs=run.call_args
                self.assertNotIn('fake-password',str(args))
                self.assertIn('default_transaction_read_only=on',kwargs['env']['PGOPTIONS'])
    def test_missing_connection_does_not_connect(self):
        self.rejects(None,'no connection attempted')
    def test_wrong_project_does_not_connect(self):
        self.rejects('postgresql://reader:fake-password@other.supabase.co/postgres?sslmode=require','authorized Supabase project')
    def test_admin_login_is_refused(self):
        self.rejects('postgresql://postgres:fake-password@db.rvvujgbaswecqohixgog.supabase.co/postgres?sslmode=require','not an administrator')
    def test_unencrypted_connection_is_refused(self):
        self.rejects('postgresql://reader:fake-password@db.rvvujgbaswecqohixgog.supabase.co/postgres','encrypted')
    def test_write_capable_login_is_refused_before_audit(self):
        self.rejects('postgresql://reader:fake-password@db.rvvujgbaswecqohixgog.supabase.co/postgres?sslmode=require','write/owner/admin','BEGIN\ntrue\nCOMMIT\n')
    def test_unexpected_role_check_output_is_refused(self):
        self.rejects('postgresql://reader:fake-password@db.rvvujgbaswecqohixgog.supabase.co/postgres?sslmode=require','unexpected preflight','BEGIN\nCOMMIT\n')
if __name__=='__main__': unittest.main()
