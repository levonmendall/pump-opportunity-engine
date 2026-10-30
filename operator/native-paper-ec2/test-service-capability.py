#!/usr/bin/env python3
import importlib.util,pathlib,types,unittest
from unittest.mock import patch
p=pathlib.Path(__file__).with_name('service-capability.py');s=importlib.util.spec_from_file_location('capability',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Tests(unittest.TestCase):
 def receipt(self):return {'exitCode':0,'timedOut':False,'stdoutBytes':10,'stderrBytes':0,'stdoutSha256':'a'*64,'stderrSha256':'b'*64}
 def test_sudo_metadata_does_not_export_policy_or_infer_generic_systemctl_permission(self):
  secret='PRIVATE_SENTINEL'
  r=m.sudo_metadata('(ALL) NOPASSWD: /usr/bin/systemctl show poe-runtime.service\n'+secret);self.assertFalse(r['passwordlessAllCommandsExplicit']);self.assertFalse(r['passwordlessPoeNativePaperStartExplicit']);self.assertNotIn(secret,str(r))
  self.assertTrue(m.sudo_metadata('(ALL : ALL) NOPASSWD: ALL')['passwordlessAllCommandsExplicit'])
  self.assertTrue(m.sudo_metadata('(root) NOPASSWD: /usr/bin/systemctl start poe-native-paper.service')['passwordlessPoeNativePaperStartExplicit'])
  self.assertFalse(m.sudo_metadata('(root) PASSWD: /usr/bin/systemctl start poe-native-paper.service')['passwordlessPoeNativePaperStartExplicit'])
 def test_relevant_sudo_command_paths_survive_but_sensitive_or_unrelated_arguments_do_not(self):
  r=m.sudo_metadata('(root) NOPASSWD: /usr/local/sbin/mm-apply *, /usr/bin/systemctl start poe-runtime.service, /usr/bin/tool SECRET_SENTINEL /etc/poe/secrets/key')
  self.assertIn('/usr/local/sbin/mm-apply',[v['commandPath']for v in r['passwordlessCommandMetadata']]);self.assertIn('/usr/bin/systemctl',[v['commandPath']for v in r['passwordlessCommandMetadata']]);self.assertFalse(any('literalPoeArguments'in v for v in r['passwordlessCommandMetadata']));self.assertNotIn('SECRET_SENTINEL',str(r));self.assertNotIn('/etc/poe/secrets',str(r));self.assertFalse(any(v['otherArgumentsExported']for v in r['passwordlessCommandMetadata']))
 def test_fixed_uid_guard_precedes_every_subprocess(self):
  with patch.object(m.os,'getuid',return_value=0),patch.object(m,'command',side_effect=AssertionError('no command permitted')):
   with self.assertRaisesRegex(m.Refusal,'FIXED_NONROOT_RUNNER_REQUIRED'):m.inspect()
 def inspect_fake(self,user_bus=False,changed=False):
  calls=[]
  def run(args,env=None):
   calls.append((args,env))
   if args[0]=='/usr/bin/sudo':return self.receipt(),'(root) NOPASSWD: /usr/bin/systemctl show poe-runtime.service\nSECRET_SENTINEL'
   if args[0]=='/usr/bin/loginctl':return self.receipt(),'Linger=no\nState=offline\nRuntimePath=\n'
   return self.receipt(),'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID='+('21'if changed and len(calls)>6 else'20')+'\nNRestarts=0\nUser=poe-runtime\nUnitFileState=enabled\nEnvironment=SECRET_SENTINEL\n'
  def status(path):return {'exists':user_bus,'uid':994,'directory':str(path)=='/run/user/994','socket':str(path).endswith('/bus'),'symlink':False,'mode':0o700}
  with patch.object(m.os,'getuid',return_value=994),patch.object(m.pwd,'getpwuid',return_value=types.SimpleNamespace(pw_name='mm-ec2-runner')),patch.dict(m.os.environ,{'ACTUAL_RUNNER':'meme-machine-ec2-admin'},clear=True),patch.object(m,'command',side_effect=run),patch.object(m,'path_status',side_effect=status):result=m.inspect()
  return result,calls
 def test_inventory_only_uses_read_only_fixed_commands_and_no_private_values(self):
  r,calls=self.inspect_fake();self.assertEqual(r['serviceStarts'],0);self.assertTrue(r['originalServiceBeforeAfterUnchanged']);self.assertFalse(r['ownerActionDetermined']);self.assertFalse(r['existingUserManager']['attempted']);self.assertNotIn('SECRET_SENTINEL',str(r));self.assertEqual(len(calls),7)
  self.assertTrue(all(a[0][0]in['/usr/bin/systemctl','/usr/bin/loginctl','/usr/bin/sudo']for a in calls));self.assertFalse(any('start'in a[0]or'enable'in a[0]for a in calls))
 def test_existing_owned_user_bus_is_selected_explicitly_and_changes_are_visible(self):
  r,calls=self.inspect_fake(True,True);self.assertTrue(r['existingUserManager']['attempted']);self.assertFalse(r['originalServiceBeforeAfterUnchanged']);call=next(v for v in calls if '--user'in v[0]);self.assertEqual(call[1],{'PATH':'/usr/bin:/bin','LANG':'C','XDG_RUNTIME_DIR':'/run/user/994','DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/994/bus'})
if __name__=='__main__':unittest.main()
